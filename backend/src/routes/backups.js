import { execFile, fork } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readdir, stat, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { requireRole } from "./auth.js";
import { audit } from "../audit.js";
import { decryptFile, hasSecretKey } from "../security.js";
import { beginRestore, endRestore, isRestoreInProgress } from "../maintenance.js";
import { createBackupName, isSafeBackupName } from "../backup-files.js";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const backupDir = path.resolve(process.env.FOOD_SYSTEM_BACKUP_DIR || path.join(root, "state", "backups"));
const recoveryMarker = path.join(path.dirname(backupDir), "restore-recovery-required");
const notifyLauncher = (type) => {
  if (!process.connected) return;
  try { process.send({ type }); } catch {}
};
const runRestore = (file) => {
  const child = fork("src/restore.js", [file], {
    cwd: path.join(root, "backend"),
    env: process.env,
    windowsHide: true,
    silent: true,
  });
  let stdout = "";
  let stderr = "";
  let importStarted = false;
  let resolveImportStart;
  const importStart = new Promise((resolveStarted) => { resolveImportStart = resolveStarted; });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout = `${stdout}${chunk}`.slice(-1024 * 1024); });
  child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-1024 * 1024); });
  child.on("message", (message) => {
    if (message?.type !== "restore-import-started" || importStarted) return;
    importStarted = true;
    resolveImportStart(true);
  });
  const promise = new Promise((resolveRestore, rejectRestore) => {
    child.once("error", (error) => {
      if (!importStarted) resolveImportStart(false);
      error.stdout = stdout;
      error.stderr = stderr;
      rejectRestore(error);
    });
    child.once("close", (code, signal) => {
      if (!importStarted) resolveImportStart(false);
      if (code === 0) return resolveRestore({ stdout, stderr });
      const error = new Error(`Restore process exited with code ${code ?? signal}`);
      error.code = code;
      error.signal = signal;
      error.stdout = stdout;
      error.stderr = stderr;
      rejectRestore(error);
    });
  });
  return { importStart, promise };
};
const requireLocalAdmin = async (request, reply) => {
  const user = await requireRole(request, reply);
  if (!user) return null;
  if (user.local !== true) {
    reply.forbidden("Database backup operations are available only to the local desktop administrator");
    return null;
  }
  return user;
};

export default async function backupRoutes(app) {
  app.get("/api/v1/businesses/:businessId/backups", async (request, reply) => {
    if (!(await requireLocalAdmin(request, reply))) return;
    if (!hasSecretKey()) return reply.code(503).send({ error: "Backup encryption key is not configured" });
    await mkdir(backupDir, { recursive: true });
    const names = (await readdir(backupDir)).filter(isSafeBackupName);
    const backups = await Promise.all(names.map(async (name) => { const info = await stat(path.join(backupDir, name)); return { name, size: info.size, created_at: info.mtime.toISOString() }; }));
    return { backups: backups.sort((a, b) => b.created_at.localeCompare(a.created_at)) };
  });

  app.post("/api/v1/businesses/:businessId/backups", async (request, reply) => {
    const user = await requireLocalAdmin(request, reply);
    if (!user) return;
    if (!hasSecretKey()) return reply.code(503).send({ error: "Backup encryption key is not configured" });
    try {
      const { stdout } = await execFileAsync(process.execPath, ["src/backup.js"], { cwd: path.join(root, "backend"), windowsHide: true });
      await audit(request, user, "backup.created", "backup", null, {});
      return reply.code(201).send({ created: true, output: stdout.trim() });
    } catch (error) { request.log.error(error); return reply.internalServerError("Backup failed"); }
  });

  app.post("/api/v1/businesses/:businessId/backups/restore", async (request, reply) => {
    if (isRestoreInProgress()) return reply.conflict("A database restore is already in progress");
    const user = await requireRole(request, reply);
    if (!user) return;
    const name = String(request.body?.name || "");
    if (!isSafeBackupName(name)) return reply.badRequest("Invalid backup name");
    if (user.local !== true) return reply.forbidden("Database backup operations are available only to the local desktop administrator");
    const file = path.resolve(backupDir, name);
    if (path.dirname(file) !== backupDir) return reply.badRequest("Invalid backup path");
    if (!(await beginRestore())) return reply.conflict("A database restore is already in progress");
    let plaintextFile = null;
    let safetyPlaintextFile = null;
    let safetyBackupFile = null;
    let restoreSucceeded = false;
    let recoverySucceeded = false;
    let restoreImportStarted = false;
    let recoveryMarkerOwned = false;
    let keepMaintenance = false;
    let safetyBackupName = null;
    try {
      safetyBackupName = createBackupName();
      safetyBackupFile = path.join(backupDir, safetyBackupName);
      await writeFile(recoveryMarker, `${JSON.stringify({ state: "in_progress", backup: name, safety_backup: safetyBackupName, created_at: new Date().toISOString() })}\n`, { mode: 0o600, flag: "wx" });
      recoveryMarkerOwned = true;
      notifyLauncher("restore-start");
      const sourceInfo = await stat(file);
      if (!sourceInfo.isFile() || sourceInfo.size === 0) return reply.badRequest("Backup file is empty or invalid");
      plaintextFile = path.join(backupDir, `.restore-${process.pid}-${randomUUID()}.sql`);
      await decryptFile(file, plaintextFile);
      const plaintextInfo = await stat(plaintextFile);
      if (!plaintextInfo.isFile() || plaintextInfo.size === 0) return reply.badRequest("Backup contains no database data");
      await execFileAsync(process.execPath, ["src/backup.js", safetyBackupName], { cwd: path.join(root, "backend"), windowsHide: true });
      await stat(safetyBackupFile);
      const originalRestore = runRestore(plaintextFile);
      const primaryRestore = originalRestore.promise.then((result) => {
        restoreSucceeded = true;
        return result;
      }, async (error) => {
        if (await originalRestore.importStart) restoreImportStarted = true;
        throw error;
      });
      try {
        await primaryRestore;
      } catch (restoreError) {
        if (!restoreImportStarted) throw restoreError;
        try {
          safetyPlaintextFile = path.join(backupDir, `.recovery-${process.pid}-${randomUUID()}.sql`);
          await decryptFile(safetyBackupFile, safetyPlaintextFile);
          await execFileAsync(process.execPath, ["src/restore.js", safetyPlaintextFile], { cwd: path.join(root, "backend"), windowsHide: true });
          recoverySucceeded = true;
        } catch (recoveryError) {
          keepMaintenance = true;
          request.log.fatal({ err: recoveryError, safety_backup: path.basename(safetyBackupFile) }, "Automatic database recovery failed; API remains in maintenance");
        }
        throw restoreError;
      }
      await audit(request, user, "backup.restored", "backup", name, { safety_backup_created: true });
      return { restored: true, name, safety_backup_created: true };
    } catch (error) {
      request.log.error(error);
      if (keepMaintenance) return reply.internalServerError("Restore and automatic recovery failed. The API remains in maintenance; contact support before restarting.");
      if (recoverySucceeded) return reply.internalServerError("Restore failed; the original database was recovered from its safety backup");
      if (restoreSucceeded) return reply.internalServerError("The backup was restored, but its audit record could not be saved. Check the restore state before retrying.");
      return reply.internalServerError("Restore failed");
    }
    finally {
      for (const temporaryFile of [plaintextFile, safetyPlaintextFile]) {
        if (!temporaryFile) continue;
        await rm(temporaryFile, { force: true }).catch((error) => request.log.error(error, "Could not remove a temporary plaintext restore file"));
      }
      if (recoveryMarkerOwned && (!restoreImportStarted || restoreSucceeded || recoverySucceeded)) {
        await rm(recoveryMarker, { force: true }).catch((error) => request.log.error(error, "Could not remove the database restore marker"));
      }
      if (!keepMaintenance) endRestore();
      if (recoveryMarkerOwned) notifyLauncher(keepMaintenance ? "restore-recovery-required" : "restore-end");
    }
  });
}
