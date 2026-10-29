import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { isSafeBackupName } from "../backend/src/backup-files.js";

const RESTORE_TEMP_PATTERN = /^\.(?:restore|recovery)-\d+-[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\.sql$/i;
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export const removeStalePlaintextBackups = async (directory, { now = Date.now(), maxAgeMs = DEFAULT_MAX_AGE_MS } = {}) => {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }

  const removed = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const isPlainBackup = entry.name.endsWith(".sql") && isSafeBackupName(`${entry.name}.enc`);
    if (!isPlainBackup && !RESTORE_TEMP_PATTERN.test(entry.name)) continue;
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
