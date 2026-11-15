import { mkdir, chmod, link, open, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { registerBackupWorker } from "./restore-coordination.js";
import { encryptFile, hasSecretKey } from "./security.js";
import { createBackupName, isSafeBackupName } from "./backup-files.js";
import { isStorageFull, STORAGE_FULL_SIGNAL } from "./storage-errors.js";

process.on("uncaughtExceptionMonitor", (error) => {
  if (isStorageFull(error)) console.error(STORAGE_FULL_SIGNAL);
  if (error?.code === "FOOD_SYSTEM_BACKUP_INVALID") console.error("FOOD_SYSTEM_BACKUP_INVALID");
});

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../");
const outputDir = path.resolve(process.env.FOOD_SYSTEM_BACKUP_DIR || path.join(root, "state", "backups"));
if (!hasSecretKey()) throw new Error("FOOD_SYSTEM_SECRET_KEY must be configured before creating backups");
const backupName = process.argv[2] || createBackupName();
if (!isSafeBackupName(backupName)) throw new Error("Invalid backup name");
const output = path.join(outputDir, backupName);
const temporaryDatabase = path.join(outputDir, `.backup-${process.pid}-${randomUUID()}.sqlite`);
const temporaryOutput = path.join(outputDir, `.encrypted-${process.pid}-${randomUUID()}.tmp`);
if (process.env.FOOD_SYSTEM_INTERNAL_RESTORE_BACKUP !== "true") await registerBackupWorker();
const { assertCompatibleSchema, createDatabaseBackup, closeDatabase } = await import("./db.js");
await mkdir(outputDir, { recursive: true, mode: 0o700 });
await chmod(outputDir, 0o700).catch(() => {});
let temporaryDatabaseCreated = false;
let temporaryOutputCreated = false;
let backupPublished = false;
let cleanupWarning = false;
try {
  const placeholder = await open(temporaryDatabase, "wx", 0o600);
  temporaryDatabaseCreated = true;
  await placeholder.close();
  await createDatabaseBackup(temporaryDatabase);
  const info = await stat(temporaryDatabase);
  if (!info.isFile() || !info.size) throw new Error("SQLite produced an empty backup");
  await chmod(temporaryDatabase, 0o600).catch(() => {});
  try {
    const candidate = new DatabaseSync(temporaryDatabase, { readOnly: true, enableForeignKeyConstraints: true, enableDoubleQuotedStringLiterals: false, timeout: 5000 });
    try {
      candidate.exec("PRAGMA trusted_schema = OFF");
      if (candidate.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok" || candidate.prepare("PRAGMA foreign_key_check").get()) throw new Error("SQLite backup contains invalid data or references");
      assertCompatibleSchema(candidate);
    } finally { candidate.close(); }
  } catch (error) {
    if (isStorageFull(error)) throw error;
    throw Object.assign(new Error("SQLite backup did not pass integrity validation", { cause: error }), { code: "FOOD_SYSTEM_BACKUP_INVALID" });
  }
  await encryptFile(temporaryDatabase, temporaryOutput);
  temporaryOutputCreated = true;
  // Publish a complete file without ever replacing a previous backup.
  await link(temporaryOutput, output);
  backupPublished = true;
} finally {
  try {
    const cleanup = await Promise.allSettled([...(temporaryDatabaseCreated ? [temporaryDatabase, `${temporaryDatabase}-wal`, `${temporaryDatabase}-shm`, `${temporaryDatabase}-journal`] : []), ...(temporaryOutputCreated ? [temporaryOutput] : [])].map((file) => rm(file, { force: true })));
    const failures = cleanup.filter((entry) => entry.status === "rejected");
    if (failures.length) {
      if (!backupPublished) throw failures[0].reason;
      cleanupWarning = true;
      console.error("Backup created, but temporary files could not be removed.");
    }
  } finally { closeDatabase(); }
}
if (cleanupWarning) console.log("BACKUP_CLEANUP_WARNING");
console.log(`Backup created: ${output}`);
