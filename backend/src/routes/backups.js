import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readdir, lstat, stat, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { requireRole } from "./auth.js";
import { audit } from "../audit.js";
import { decryptFile, hasSecretKey } from "../security.js";
import { beginRestore, endRestore, isRestoreInProgress } from "../maintenance.js";
import { replaceDatabase } from "../db.js";
import { createBackupName, isSafeBackupName } from "../backup-files.js";

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
const validateDatabase = (file) => {
  const candidate = new DatabaseSync(file, { readOnly: true, enableForeignKeyConstraints: true, enableDoubleQuotedStringLiterals: false, timeout: 5000 });
  try {
    candidate.exec("PRAGMA trusted_schema = OFF");
    const integrity = candidate.prepare("PRAGMA integrity_check").get();
    if (integrity.integrity_check !== "ok") throw new Error("Backup failed SQLite integrity validation");
    if (candidate.prepare("PRAGMA foreign_key_check").all().length) throw new Error("Backup contains foreign-key violations");
    const tables = new Set(candidate.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name));
    for (const name of ["businesses", "users", "orders", "app_schema_migrations"]) if (!tables.has(name)) throw new Error("Backup does not contain the Food System schema");
    if (!candidate.prepare("SELECT 1 FROM app_schema_migrations WHERE version = '025_mariadb_schema_baseline'").get()) throw new Error("Backup does not contain a recognized Food System schema baseline");
  } finally { candidate.close(); }
};

export default async function backupRoutes(app) {
  app.get("/api/v1/businesses/:businessId/backups", async (request, reply) => {
    if (!(await requireLocalAdmin(request, reply))) return;
    if (!hasSecretKey()) return reply.code(503).send({ error: "Backup encryption key is not configured" });
    await mkdir(backupDir, { recursive: true, mode: 0o700 });
    const entries = await readdir(backupDir, { withFileTypes: true });
    const names = entries.filter((entry) => entry.isFile() && isSafeBackupName(entry.name)).map((entry) => entry.name);
    const backups = await Promise.all(names.map(async (name) => {
      const info = await lstat(path.join(backupDir, name));
      if (!info.isFile()) return null;
      return { name, size: info.size, created_at: info.mtime.toISOString() };
    }));
    return { backups: backups.filter(Boolean).sort((a, b) => b.created_at.localeCompare(a.created_at)) };
  });

  app.post("/api/v1/businesses/:businessId/backups", async (request, reply) => {
    const user = await requireLocalAdmin(request, reply);
    if (!user) return;
    if (!hasSecretKey()) return reply.code(503).send({ error: "Backup encryption key is not configured" });
    try {
      const { stdout } = await execFileAsync(process.execPath, ["src/backup.js"], { cwd: backendRoot, windowsHide: true });
      await audit(request, user, "backup.created", "backup", null, {});
      return reply.code(201).send({ created: true, output: stdout.trim() });
    } catch (error) { request.log.error(error); return reply.internalServerError("Backup failed"); }
  });

  app.post("/api/v1/businesses/:businessId/backups/restore", async (request, reply) => {
    if (isRestoreInProgress()) return reply.conflict("A database restore is already in progress");
    const user = await requireRole(request, reply);
    if (!user) return;
    const name = request.body && typeof request.body === "object" && !Array.isArray(request.body) && typeof request.body.name === "string" ? request.body.name : "";
    if (!name || name.includes("..") || name.includes("/") || name.includes("\\")) return reply.badRequest("Invalid backup name");
    if (user.local !== true) return reply.forbidden("Database backup operations are available only to the local desktop administrator");
    if (!isSafeBackupName(name)) return reply.badRequest("Invalid backup name");
    if (!hasSecretKey()) return reply.code(503).send({ error: "Backup encryption key is not configured" });
    const file = path.resolve(backupDir, name);
    if (path.dirname(file) !== backupDir) return reply.badRequest("Invalid backup path");
    let sourceInfo;
    try { sourceInfo = await lstat(file); } catch (error) { if (error.code === "ENOENT") return reply.notFound("Backup not found"); throw error; }
    if (!sourceInfo.isFile() || sourceInfo.size === 0) return reply.badRequest("Backup file is empty or invalid");
    if (!(await beginRestore())) return reply.conflict("A database restore is already in progress");
    let plain = null;
    let safetyPlain = null;
    let recoveryMarkerOwned = false;
    let restoreSucceeded = false;
    let recoverySucceeded = false;
    let keepMaintenance = false;
    let safetyName = null;
    try {
      await mkdir(backupDir, { recursive: true, mode: 0o700 });
      safetyName = createBackupName();
      const safetyFile = path.join(backupDir, safetyName);
      await writeFile(recoveryMarker, `${JSON.stringify({ state: "in_progress", backup: name, safety_backup: safetyName, created_at: new Date().toISOString() })}\n`, { mode: 0o600, flag: "wx" });
      recoveryMarkerOwned = true;
      notifyLauncher("restore-start");
      plain = path.join(backupDir, `.restore-${process.pid}-${randomUUID()}.sqlite`);
      await decryptFile(file, plain);
      if (!(await stat(plain)).size) return reply.badRequest("Backup contains no database data");
      validateDatabase(plain);
      await execFileAsync(process.execPath, ["src/backup.js", safetyName], { cwd: backendRoot, windowsHide: true });
      const original = path.join(backupDir, safetyName);
      await stat(original);
      try {
        await replaceDatabase(plain);
        restoreSucceeded = true;
      } catch (restoreError) {
        try {
          safetyPlain = path.join(backupDir, `.recovery-${process.pid}-${randomUUID()}.sqlite`);
          await decryptFile(original, safetyPlain);
          validateDatabase(safetyPlain);
          await replaceDatabase(safetyPlain);
          recoverySucceeded = true;
        } catch (recoveryError) {
          keepMaintenance = true;
          request.log.fatal({ err: recoveryError, safety_backup: safetyName }, "Automatic SQLite recovery failed; API remains in maintenance");
        }
        throw restoreError;
      }
      await audit(request, user, "backup.restored", "backup", null, { backup_name: name, safety_backup_created: true });
      return { restored: true, name, safety_backup_created: true };
    } catch (error) {
      request.log.error(error);
      if (keepMaintenance) return reply.internalServerError("Restore and automatic recovery failed. The API remains in maintenance; contact support before restarting.");
      if (recoverySucceeded) return reply.internalServerError("Restore failed; the original database was recovered from its safety backup");
      if (restoreSucceeded) return reply.internalServerError("The backup was restored, but its audit record could not be saved. Check the restore state before retrying.");
      return reply.internalServerError("Restore failed");
    } finally {
      for (const temp of [plain, safetyPlain]) if (temp) await rm(temp, { force: true }).catch((error) => request.log.error(error, "Could not remove a temporary plaintext restore file"));
      if (recoveryMarkerOwned && (!restoreSucceeded || recoverySucceeded || !keepMaintenance)) await rm(recoveryMarker, { force: true }).catch((error) => request.log.error(error, "Could not remove the database restore marker"));
      if (!keepMaintenance) endRestore();
      if (recoveryMarkerOwned) notifyLauncher(keepMaintenance ? "restore-recovery-required" : "restore-end");
    }
  });
}
