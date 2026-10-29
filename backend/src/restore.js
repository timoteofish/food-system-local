import { execFile, spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { config } from "./config.js";

const execFileAsync = promisify(execFile);
const input = process.argv[2];
if (!input) throw new Error("Uso: npm run db:restore -- caminho\\backup.sql");
await access(input);

const candidates = [
  process.env.MARIADB_CLIENT_PATH,
  process.env.MARIADB_ROOT ? path.join(process.env.MARIADB_ROOT, "bin", "mariadb.exe") : "",
  "mariadb",
  "mysql",
  "C:\\Program Files\\MariaDB 11.8\\bin\\mariadb.exe",
  "C:\\Program Files\\MariaDB 13.0\\bin\\mariadb.exe",
].filter(Boolean);
let client;
for (const candidate of candidates) {
  try { await execFileAsync(candidate, ["--version"]); client = candidate; break; } catch { }
}
if (!client) throw new Error("mariadb/mysql não encontrado. Instale MariaDB ou defina MARIADB_CLIENT_PATH.");

const mysql = config.mysqlMaintenance;
const clientArgs = ["--host", mysql.host, "--port", String(mysql.port), "--user", mysql.user, mysql.database];
const clientEnv = { ...process.env, MYSQL_PWD: mysql.password };
await execFileAsync(client, ["--host", mysql.host, "--port", String(mysql.port), "--user", mysql.user, "--execute", "SELECT 1", mysql.database], { env: clientEnv, windowsHide: true, timeout: 10000 });
const child = spawn(client, clientArgs, {
  env: clientEnv,
  windowsHide: true,
  stdio: ["pipe", "inherit", "inherit"],
});
const closePromise = new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("close", (code, signal) => resolve({ code, signal }));
});
child.once("spawn", () => {
  if (process.connected) {
    try { process.send({ type: "restore-import-started" }); } catch {}
  }
  process.stdout.write("Food System restore importer started\n");
});
let timedOut = false;
const timeout = setTimeout(() => {
  timedOut = true;
  child.kill();
}, 120000);
try {
  const [inputResult, processResult] = await Promise.allSettled([
    pipeline(createReadStream(input), child.stdin),
    closePromise,
  ]);
  if (processResult.status === "rejected") throw processResult.reason;
  if (timedOut) throw new Error("Database restore exceeded the 120-second limit");
  if (processResult.value.code !== 0) throw new Error(`Restauração falhou com código ${processResult.value.code ?? processResult.value.signal}`);
  if (inputResult.status === "rejected") throw inputResult.reason;
} finally {
  clearTimeout(timeout);
  if (child.exitCode === null && !child.killed) child.kill();
  await closePromise.catch(() => {});
}
console.log(`Backup restaurado: ${input}`);
