import { execFile } from "node:child_process";
import { mkdir, access, chmod, rename, rm, stat } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { encryptFile, hasSecretKey } from "./security.js";
import { createBackupName, isSafeBackupName } from "./backup-files.js";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../");
const outputDir = path.resolve(process.env.FOOD_SYSTEM_BACKUP_DIR || path.join(root, "state", "backups"));
if (!hasSecretKey()) throw new Error("FOOD_SYSTEM_SECRET_KEY must be configured before creating backups");

const candidates = [
  process.env.MARIADB_DUMP_PATH,
  process.env.MARIADB_ROOT ? path.join(process.env.MARIADB_ROOT, "bin", "mariadb-dump.exe") : "",
  "mariadb-dump",
  "mysqldump",
  "C:\\Program Files\\MariaDB 11.8\\bin\\mariadb-dump.exe",
  "C:\\Program Files\\MariaDB 13.0\\bin\\mariadb-dump.exe",
].filter(Boolean);

const findDumpTool = async () => {
  for (const candidate of candidates) {
    try { await access(candidate); return candidate; } catch { }
  }
  throw new Error("mariadb-dump/mysqldump não encontrado. Instale MariaDB ou defina MARIADB_DUMP_PATH.");
};

const backupName = process.argv[2] || createBackupName();
if (!isSafeBackupName(backupName)) throw new Error("Invalid backup name");
const plainOutput = path.join(outputDir, backupName.replace(/\.enc$/, ""));
const output = path.join(outputDir, backupName);
const temporaryOutput = `${output}.tmp`;
await mkdir(outputDir, { recursive: true });
// Keep backup material private on POSIX systems. Windows inherits the AppData
// directory ACL, which is established by the current-user installation.
await chmod(outputDir, 0o700).catch(() => {});
const dumpTool = await findDumpTool();
const mysql = config.mysqlMaintenance;
const sslArgs = mysql.host === "127.0.0.1" || mysql.host === "localhost" ? ["--skip-ssl"] : [];
try {
  await execFileAsync(dumpTool, ["--host", mysql.host, "--port", String(mysql.port), "--user", mysql.user, ...sslArgs, "--single-transaction", "--routines", "--triggers", mysql.database, "--result-file", plainOutput], {
    env: { ...process.env, MYSQL_PWD: mysql.password },
    windowsHide: true,
    timeout: 120000,
  });
  const dumpInfo = await stat(plainOutput);
  if (!dumpInfo.isFile() || dumpInfo.size === 0) throw new Error("MariaDB produced an empty backup; the backup was not published");
  await chmod(plainOutput, 0o600).catch(() => {});
  await encryptFile(plainOutput, temporaryOutput);
  await rename(temporaryOutput, output);
} finally {
  await Promise.all([
    rm(plainOutput, { force: true }),
    rm(temporaryOutput, { force: true }),
  ]);
}
console.log(`Backup criado: ${output}`);
