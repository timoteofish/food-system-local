import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { isSafeBackupName } from "../backend/src/backup-files.js";

const RESTORE_TEMP_PATTERN = /^\.(?:restore|recovery)-\d+-[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\.sqlite(?:-(?:wal|shm|journal))?$/i;
// Earlier releases used only the process ID; newer backups add a random UUID.
const BACKUP_TEMP_PATTERN = /^\.backup-\d+(?:-[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})?\.sqlite(?:-(?:wal|shm|journal))?$/i;
// A grace period and a live-process check protect active work while limiting
// exposure of plaintext left behind by a crash or forced shutdown.
const DEFAULT_MAX_AGE_MS = 60 * 60 * 1000;

const processIsRunning = (pid) => {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === "ESRCH") return false; return true; }
};

export const removeStalePlaintextBackups = async (directory, { now = Date.now(), maxAgeMs = DEFAULT_MAX_AGE_MS, includePlainBackups = true, isProcessRunning = processIsRunning } = {}) => {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }

  const removed = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const isPlainBackup = includePlainBackups && entry.name.endsWith(".sqlite") && isSafeBackupName(`${entry.name}.enc`);
    if (!isPlainBackup && !RESTORE_TEMP_PATTERN.test(entry.name) && !BACKUP_TEMP_PATTERN.test(entry.name)) continue;
    const pid = /^\.(?:backup|restore|recovery)-(\d+)/.exec(entry.name)?.[1];
    if (pid && isProcessRunning(Number(pid))) continue;
    const file = path.join(directory, entry.name);
    let info;
    try { info = await stat(file); }
    catch (error) { if (error.code === "ENOENT") continue; throw error; }
    if (now - info.mtimeMs <= maxAgeMs) continue;
    await rm(file, { force: true });
    removed.push(entry.name);
  }
  return removed;
};

