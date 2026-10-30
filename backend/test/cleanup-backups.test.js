import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createBackupName } from "../src/backup-files.js";
import { removeStalePlaintextBackups } from "../../desktop/cleanup-backups.mjs";

test("startup cleanup removes only stale plaintext backups and restore dumps", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "food-system-backups-"));
  const now = Date.now();
  const staleDate = new Date(now - 25 * 60 * 60 * 1000);
  const recentDate = new Date(now - 30 * 60 * 1000);
  const staleDump = createBackupName(new Date("2026-01-01T00:00:00.000Z")).replace(/\.enc$/, "");
  const staleRestore = ".restore-123-12345678-1234-1234-1234-123456789abc.sql";
  const recentRestore = ".recovery-124-12345678-1234-1234-1234-123456789abc.sql";
  const recentDump = createBackupName(new Date("2026-01-03T00:00:00.000Z")).replace(/\.enc$/, "");
  const encryptedBackup = createBackupName(new Date("2026-01-02T00:00:00.000Z"));
  const arbitrarySql = "customer-export.sql";
  try {
    for (const name of [staleDump, staleRestore, recentRestore, recentDump, encryptedBackup, arbitrarySql]) {
      await writeFile(path.join(directory, name), "data");
    }
    await utimes(path.join(directory, staleDump), staleDate, staleDate);
    await utimes(path.join(directory, staleRestore), staleDate, staleDate);
    await utimes(path.join(directory, recentRestore), recentDate, recentDate);
    await utimes(path.join(directory, recentDump), recentDate, recentDate);
    const removed = await removeStalePlaintextBackups(directory, { now });
    assert.deepEqual(removed.sort(), [staleDump, staleRestore].sort());
    const remaining = await readdir(directory);
    assert.deepEqual(remaining.sort(), [recentRestore, recentDump, encryptedBackup, arbitrarySql].sort());
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
