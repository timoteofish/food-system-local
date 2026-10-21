import { execFile, spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { promisify } from "node:util";
import { config } from "./config.js";

const execFileAsync = promisify(execFile);
const input = process.argv[2];
if (!input) throw new Error("Uso: npm run db:restore -- caminho\\backup.sql");
await access(input);

const candidates = [
  process.env.MARIADB_CLIENT_PATH,
  "mariadb",
  "mysql",
  "C:\\Program Files\\MariaDB 13.0\\bin\\mariadb.exe",
  "C:\\Program Files\\MariaDB 11.0\\bin\\mariadb.exe",
].filter(Boolean);
let client;
for (const candidate of candidates) {
  try { await execFileAsync(candidate, ["--version"]); client = candidate; break; } catch { }
}
if (!client) throw new Error("mariadb/mysql não encontrado. Instale MariaDB ou defina MARIADB_CLIENT_PATH.");

const child = spawn(client, ["--host", config.mysql.host, "--port", String(config.mysql.port), "--user", config.mysql.user, config.mysql.database], {
  env: { ...process.env, MYSQL_PWD: config.mysql.password },
  windowsHide: true,
  stdio: ["pipe", "inherit", "inherit"],
});
const code = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("close", resolve);
  import("node:fs").then(({ createReadStream }) => createReadStream(input).pipe(child.stdin));
});
if (code !== 0) throw new Error(`Restauração falhou com código ${code}`);
console.log(`Backup restaurado: ${input}`);
