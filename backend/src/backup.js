import { execFile } from "node:child_process";
import { mkdir, access } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../");
const outputDir = path.resolve(process.env.FOOD_SYSTEM_BACKUP_DIR || path.join(root, "state", "backups"));

const candidates = [
  process.env.MARIADB_DUMP_PATH,
  "mariadb-dump",
  "mysqldump",
  "C:\\Program Files\\MariaDB 13.0\\bin\\mariadb-dump.exe",
  "C:\\Program Files\\MariaDB 11.0\\bin\\mariadb-dump.exe",
].filter(Boolean);

const findDumpTool = async () => {
  for (const candidate of candidates) {
    try { await access(candidate); return candidate; } catch { }
  }
  throw new Error("mariadb-dump/mysqldump não encontrado. Instale MariaDB ou defina MARIADB_DUMP_PATH.");
};

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const output = path.join(outputDir, `food-system-${stamp}.sql`);
await mkdir(outputDir, { recursive: true });
const dumpTool = await findDumpTool();
const sslArgs = config.mysql.host === "127.0.0.1" || config.mysql.host === "localhost" ? ["--skip-ssl"] : [];
await execFileAsync(dumpTool, ["--host", config.mysql.host, "--port", String(config.mysql.port), "--user", config.mysql.user, ...sslArgs, "--single-transaction", "--routines", "--triggers", config.mysql.database, "--result-file", output], {
  env: { ...process.env, MYSQL_PWD: config.mysql.password },
  windowsHide: true,
});
console.log(`Backup criado: ${output}`);
