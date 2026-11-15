import { mkdir, open, readdir, rm, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configuredDataDir = process.env.FOOD_SYSTEM_DATA_DIR || path.join(backendRoot, "state");
export const databasePath = path.resolve(process.env.FOOD_SYSTEM_DB_PATH || path.join(configuredDataDir, "food-system.sqlite"));
const restoreGuard = `${databasePath}.restore-lock`;
const workerPrefixes = ["print", "backup", "maintenance", "api"].map((kind) => `${path.basename(databasePath)}.${kind}-worker-`);

const exists = async (file) => {
  try { await stat(file); return true; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
};

const removeStoppedWorkers = async ({ ignoreOwnApi = false } = {}) => {
  let active = false;
  for (const name of await readdir(path.dirname(databasePath))) {
    const workerPrefix = workerPrefixes.find((prefix) => name.startsWith(prefix));
    if (!workerPrefix) continue;
    const suffix = name.slice(workerPrefix.length);
    const match = /^(\d+)-[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\.lock$/i.exec(suffix);
    if (!match) continue;
    const pid = Number(match[1]);
    if (ignoreOwnApi && pid === process.pid && workerPrefix === `${path.basename(databasePath)}.api-worker-`) continue;
    let alive = true;
    try { process.kill(pid, 0); } catch (error) { if (error.code === "ESRCH") alive = false; else if (error.code !== "EPERM") throw error; }
    if (alive) active = true;
    else await rm(path.join(path.dirname(databasePath), name), { force: true });
  }
  return active;
};

const registerWorker = async (kind) => {
  await mkdir(path.dirname(databasePath), { recursive: true, mode: 0o700 });
  if (await exists(restoreGuard)) throw new Error("Database restore is in progress or requires review");
  await removeStoppedWorkers();
  const marker = path.join(path.dirname(databasePath), `${path.basename(databasePath)}.${kind}-worker-${process.pid}-${randomUUID()}.lock`);
  const file = await open(marker, "wx", 0o600);
  await file.close();
  if (await exists(restoreGuard)) {
    await rm(marker, { force: true });
    throw new Error("Database restore is in progress or requires review");
  }
  // Keep the marker until another process confirms this PID has exited. Removing
  // it in an exit handler would precede OS closure of the SQLite connection.
};

export const registerPrintWorker = () => registerWorker("print");
export const registerBackupWorker = () => registerWorker("backup");
export const registerMaintenanceWorker = () => registerWorker("maintenance");
export const registerApiWorker = () => registerWorker("api");

export const acquireRestoreGuard = async ({ ignoreOwnApi = false } = {}) => {
  await mkdir(path.dirname(databasePath), { recursive: true, mode: 0o700 });
  let guard;
  try { guard = await open(restoreGuard, "wx", 0o600); }
  catch (error) { if (error.code === "EEXIST") return null; throw error; }
  try {
    await guard.writeFile(`${JSON.stringify({ pid: process.pid, source: ignoreOwnApi ? "api" : "command", created_at: new Date().toISOString() })}\n`);
    await guard.sync();
  } catch (error) {
    await guard.close().catch(() => {});
    await rm(restoreGuard, { force: true });
    throw error;
  }
  await guard.close();
  const release = async () => rm(restoreGuard, { force: true });
  try {
    if (await removeStoppedWorkers({ ignoreOwnApi })) { await release(); return null; }
    return release;
  } catch (error) {
    await release();
    throw error;
  }
};
