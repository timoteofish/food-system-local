import { mkdir, chmod, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabaseBackup, closeDatabase } from "./db.js";
import { encryptFile, hasSecretKey } from "./security.js";
import { createBackupName, isSafeBackupName } from "./backup-files.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../");
const outputDir = path.resolve(process.env.FOOD_SYSTEM_BACKUP_DIR || path.join(root, "state", "backups"));
if (!hasSecretKey()) throw new Error("FOOD_SYSTEM_SECRET_KEY must be configured before creating backups");
const backupName = process.argv[2] || createBackupName();
if (!isSafeBackupName(backupName)) throw new Error("Invalid backup name");
const output = path.join(outputDir, backupName);
const temporaryDatabase = path.join(outputDir, `.backup-${process.pid}.sqlite`);
const temporaryOutput = `${output}.tmp`;
await mkdir(outputDir, { recursive: true, mode: 0o700 });
await chmod(outputDir, 0o700).catch(() => {});
try {
  await createDatabaseBackup(temporaryDatabase);
  const info = await stat(temporaryDatabase);
  if (!info.isFile() || !info.size) throw new Error("SQLite produced an empty backup");
  await chmod(temporaryDatabase, 0o600).catch(() => {});
  await encryptFile(temporaryDatabase, temporaryOutput);
  await rename(temporaryOutput, output);
} finally {
  await Promise.all([rm(temporaryDatabase, { force: true }), rm(temporaryOutput, { force: true })]);
  closeDatabase();
}
console.log(`Backup created: ${output}`);
