import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { promisify } from "node:util";
import { mkdir, chmod, readdir, readFile, lstat, stat, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { requireRole } from "./auth.js";
import { audit } from "../audit.js";
import { decryptFile, hasSecretKey } from "../security.js";
import { beginRestore, endRestore, isRestoreInProgress } from "../maintenance.js";
import { assertCompatibleSchema, replaceDatabase } from "../db.js";
import { createBackupName, isSafeBackupName } from "../backup-files.js";
import { acquireRestoreGuard } from "../restore-coordination.js";
import { isInvalidBackup, isStorageFull } from "../storage-errors.js";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const backendRoot = path.join(root, "backend");
const backupDir = path.resolve(process.env.FOOD_SYSTEM_BACKUP_DIR || path.join(root, "state", "backups"));
const recoveryMarker = path.join(path.dirname(backupDir), "restore-recovery-required");
const notifyLauncher = (type) => { if (process.connected) { try { process.send({ type }); } catch {} } };
const requireLocalAdmin = async (request, reply) => {
  const user = await requireRole(request, reply);
  if (!user) return null;
  if (user.local !== true) { reply.forbidden("Database backup operations are available only to the local desktop administrator"); return null; }
  return user;
};
const ensureBackupDirectory = async () => {
  await mkdir(backupDir, { recursive: true, mode: 0o700 });
  const info = await lstat(backupDir);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Backup path must be a real directory");
  if (process.platform !== "win32") await chmod(backupDir, 0o700);
};
const validateDatabase = (file) => {
  const candidate = new DatabaseSync(file, { readOnly: true, enableForeignKeyConstraints: true, enableDoubleQuotedStringLiterals: false, timeout: 5000 });
  try {
    candidate.exec("PRAGMA trusted_schema = OFF");
    const integrity = candidate.prepare("PRAGMA integrity_check").get();
    if (integrity.integrity_check !== "ok") throw new Error("Backup failed SQLite integrity validation");
    if (candidate.prepare("PRAGMA foreign_key_check").all().length) throw new Error("Backup contains foreign-key violations");
    assertCompatibleSchema(candidate);
  } finally { candidate.close(); }
};

export default async function backupRoutes(app) {
  app.get("/api/v1/businesses/:businessId/backups", async (request, reply) => {
    if (!(await requireLocalAdmin(request, reply))) return;
    if (!hasSecretKey()) return reply.code(503).send({ error: "Backup encryption key is not configured" });
    await ensureBackupDirectory();
    const entries = await readdir(backupDir, { withFileTypes: true });
    const names = entries.filter((entry) => entry.isFile() && isSafeBackupName(entry.name)).map((entry) => entry.name);
    const backups = await Promise.all(names.map(async (name) => {
      const info = await lstat(path.join(backupDir, name));
      if (!info.isFile()) return null;
      return { name, size: info.size, created_at: info.mtime.toISOString() };
    }));
    return { backups: backups.filter(Boolean).sort((a, b) => b.created_at.localeCompare(a.created_at)) };
  });

  app.get("/api/v1/businesses/:businessId/backups/:name/download", async (request, reply) => {
    if (!(await requireLocalAdmin(request, reply))) return;
    if (!hasSecretKey()) return reply.code(503).send({ error: "Backup encryption key is not configured" });
    const name = request.params.name;
    if (!isSafeBackupName(name)) return reply.badRequest("Invalid backup name");
    await ensureBackupDirectory();
    const file = path.resolve(backupDir, name);
    if (path.dirname(file) !== backupDir) return reply.badRequest("Invalid backup path");
    let info;
    try { info = await lstat(file); }
    catch (error) { if (error.code === "ENOENT") return reply.notFound("Backup not found"); throw error; }
    if (!info.isFile() || info.size === 0) return reply.badRequest("Backup file is empty or invalid");
    reply.header("Content-Type", "application/octet-stream");
    reply.header("Content-Disposition", `attachment; filename="${name}"`);
    return reply.send(createReadStream(file));
  });

  app.delete("/api/v1/businesses/:businessId/backups/:name", async (request, reply) => {
    const user = await requireLocalAdmin(request, reply);
    if (!user) return;
    if (!hasSecretKey()) return reply.code(503).send({ error: "Backup encryption key is not configured" });
    const name = request.params.name;
    if (!isSafeBackupName(name)) return reply.badRequest("Invalid backup name");
    await ensureBackupDirectory();
    const file = path.resolve(backupDir, name);
    if (path.dirname(file) !== backupDir) return reply.badRequest("Invalid backup path");
    let info;
    try { info = await lstat(file); }
    catch (error) { if (error.code === "ENOENT") return reply.notFound("Backup not found"); throw error; }
    if (!info.isFile()) return reply.badRequest("Backup file is invalid");

    const recovery = await readFile(recoveryMarker, "utf8").then((text) => JSON.parse(text)).catch(() => null);
    if (recovery && (recovery.backup === name || recovery.safety_backup === name)) {
      const recoveryError = "This backup is required to recover the database; contact support before deleting it";
      return reply.code(409).send({ error: recoveryError, message: recoveryError });
    }

    await rm(file, { force: false });
    request.auditAttempted = true;
    try { await audit(request, user, "backup.deleted", "backup", null, { backup_name: name }); }
    catch (error) { request.log.error(error, "Backup deleted but audit record failed"); }
    return { deleted: true, name };
  });

  app.post("/api/v1/businesses/:businessId/backups", async (request, reply) => {
    const user = await requireLocalAdmin(request, reply);
    if (!user) return;
    if (!hasSecretKey()) return reply.code(503).send({ error: "Backup encryption key is not configured" });
    let stdout;
    try {
      ({ stdout } = await execFileAsync(process.execPath, ["src/backup.js"], { cwd: backendRoot, windowsHide: true, env: { ...process.env, FOOD_SYSTEM_INTERNAL_RESTORE_BACKUP: "" } }));
    } catch (error) {
      request.log.error(error);
      if (isStorageFull(error)) return reply.code(507).send({ error: "Insufficient storage for backup" });
      if (isInvalidBackup(error)) return reply.code(422).send({ error: "Backup failed integrity validation" });
      return reply.internalServerError("Backup failed");
    }
    let auditRecorded = true;
    request.auditAttempted = true;
    try { await audit(request, user, "backup.created", "backup", null, {}); }
    catch (error) { auditRecorded = false; request.log.error(error, "Backup created but audit record failed"); }
    return reply.code(201).send({ created: true, output: stdout.trim(), audit_recorded: auditRecorded, cleanup_warning: stdout.split(/\r?\n/).includes("BACKUP_CLEANUP_WARNING") });
  });

  app.post("/api/v1/businesses/:businessId/backups/restore", async (request, reply) => {
    const user = await requireRole(request, reply);
    if (!user) return;
    if (isRestoreInProgress()) return reply.conflict("A database restore is already in progress");
    const name = request.body && typeof request.body === "object" && !Array.isArray(request.body) && typeof request.body.name === "string" ? request.body.name : "";
    if (!name || name.includes("..") || name.includes("/") || name.includes("\\")) return reply.badRequest("Invalid backup name");
    if (user.local !== true) return reply.forbidden("Database backup operations are available only to the local desktop administrator");
    if (!isSafeBackupName(name)) return reply.badRequest("Invalid backup name");
    if (!hasSecretKey()) return reply.code(503).send({ error: "Backup encryption key is not configured" });
    try { await ensureBackupDirectory(); }
    catch (error) { if (isStorageFull(error)) return reply.code(507).send({ error: "Insufficient storage for restore" }); throw error; }
    const file = path.resolve(backupDir, name);
    if (path.dirname(file) !== backupDir) return reply.badRequest("Invalid backup path");
    let sourceInfo;
    try { sourceInfo = await lstat(file); } catch (error) { if (error.code === "ENOENT") return reply.notFound("Backup not found"); throw error; }
    if (!sourceInfo.isFile() || sourceInfo.size === 0) return reply.badRequest("Backup file is empty or invalid");
    if (!(await beginRestore())) return reply.conflict("A database restore is already in progress");
    let plain = null;
    let safetyPlain = null;
    let plainOwned = false;
    let safetyPlainOwned = false;
    let recoveryMarkerOwned = false;
    let restoreSucceeded = false;
    let recoverySucceeded = false;
    let keepMaintenance = false;
    let safetyName = null;
    let safetyCleanupWarning = false;
    let successResponse = null;
    let releaseRestoreGuard = null;
    try {
      releaseRestoreGuard = await acquireRestoreGuard({ ignoreOwnApi: true });
      if (!releaseRestoreGuard) return reply.conflict("Stop other API, print, backup or maintenance processes, or review an existing restore lock before restoring");
      await ensureBackupDirectory();
      safetyName = createBackupName();
      const safetyFile = path.join(backupDir, safetyName);
      await writeFile(recoveryMarker, `${JSON.stringify({ state: "in_progress", backup: name, safety_backup: safetyName, created_at: new Date().toISOString() })}\n`, { mode: 0o600, flag: "wx" });
      recoveryMarkerOwned = true;
      notifyLauncher("restore-start");
      plain = path.join(backupDir, `.restore-${process.pid}-${randomUUID()}.sqlite`);
      await decryptFile(file, plain);
      plainOwned = true;
      if (!(await stat(plain)).size) { reply.code(400); return { error: "Backup contains no database data" }; }
      validateDatabase(plain);
      const safetyBackup = await execFileAsync(process.execPath, ["src/backup.js", safetyName], { cwd: backendRoot, windowsHide: true, env: { ...process.env, FOOD_SYSTEM_INTERNAL_RESTORE_BACKUP: "true" } });
      safetyCleanupWarning = safetyBackup.stdout.split(/\r?\n/).includes("BACKUP_CLEANUP_WARNING");
      const original = path.join(backupDir, safetyName);
      await stat(original);
      try {
        await replaceDatabase(plain);
        restoreSucceeded = true;
      } catch (restoreError) {
        try {
          safetyPlain = path.join(backupDir, `.recovery-${process.pid}-${randomUUID()}.sqlite`);
          await decryptFile(original, safetyPlain);
          safetyPlainOwned = true;
          validateDatabase(safetyPlain);
          await replaceDatabase(safetyPlain);
          recoverySucceeded = true;
        } catch (recoveryError) {
          keepMaintenance = true;
          request.log.fatal({ err: recoveryError, safety_backup: safetyName }, "Automatic SQLite recovery failed; API remains in maintenance");
        }
        throw restoreError;
      }
      let auditRecorded = true;
      request.auditAttempted = true;
      try { await audit(request, user, "backup.restored", "backup", null, { backup_name: name, safety_backup_created: true }); }
      catch (error) { auditRecorded = false; request.log.error(error, "Backup restored but audit record failed"); }
      successResponse = { restored: true, name, safety_backup_created: true, audit_recorded: auditRecorded, cleanup_warning: safetyCleanupWarning };
      return successResponse;
    } catch (error) {
      request.log.error(error);
      if (!keepMaintenance && !recoverySucceeded && !restoreSucceeded && error.message.startsWith("The database uses unsupported schema versions:")) {
        reply.code(409);
        return { error: "Backup requires a different application version" };
      }
      reply.code(500);
      if (keepMaintenance) return { error: "Restore and automatic recovery failed. The API remains in maintenance; contact support before restarting." };
      if (recoverySucceeded) return { error: isStorageFull(error) ? "Restore failed due to insufficient storage; the original database was recovered" : "Restore failed; the original database was recovered from its safety backup" };
      if (restoreSucceeded) return { error: "The backup was restored, but its audit record could not be saved. Check the restore state before retrying." };
      if (isStorageFull(error)) { reply.code(507); return { error: "Insufficient storage for restore" }; }
      if (isInvalidBackup(error)) { reply.code(409); return { error: "Current database failed integrity validation; a restorable safety backup could not be created" }; }
      return { error: "Restore failed" };
    } finally {
      for (const temp of [plainOwned ? plain : null, safetyPlainOwned ? safetyPlain : null]) {
        if (!temp) continue;
        for (const file of [temp, `${temp}-wal`, `${temp}-shm`]) {
          await rm(file, { force: true }).catch((error) => {
            if (successResponse) successResponse.cleanup_warning = true;
            request.log.error(error, "Could not remove a temporary plaintext restore file");
          });
        }
      }
      if (recoveryMarkerOwned && !keepMaintenance) await rm(recoveryMarker, { force: true }).catch((error) => { if (successResponse) successResponse.cleanup_warning = true; request.log.error(error, "Could not remove the database restore marker"); });
      if (releaseRestoreGuard && !keepMaintenance) await releaseRestoreGuard().catch((error) => { if (successResponse) successResponse.cleanup_warning = true; request.log.error(error, "Could not remove the restore coordination lock"); });
      if (!keepMaintenance) endRestore();
      if (recoveryMarkerOwned) notifyLauncher(keepMaintenance ? "restore-recovery-required" : "restore-end");
    }
  });
}
