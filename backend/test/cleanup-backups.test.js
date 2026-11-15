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
  const staleRestore = ".restore-123-12345678-1234-1234-1234-123456789abc.sqlite";
  const staleBackup = ".backup-123-12345678-1234-1234-1234-123456789abc.sqlite";
  const staleLegacyBackup = ".backup-456.sqlite";
  const staleJournal = `${staleBackup}-journal`;
  const recentBackup = ".backup-789-12345678-1234-1234-1234-123456789abc.sqlite";
  const unrelatedBackup = ".backup-not-a-process.sqlite";
  const recentRestore = ".recovery-124-12345678-1234-1234-1234-123456789abc.sqlite";
  const recentDump = createBackupName(new Date("2026-01-03T00:00:00.000Z")).replace(/\.enc$/, "");
  const encryptedBackup = createBackupName(new Date("2026-01-02T00:00:00.000Z"));
  const arbitrarySql = "customer-export.sql";
  try {
    for (const name of [staleDump, staleRestore, staleBackup, staleLegacyBackup, staleJournal, recentBackup, unrelatedBackup, recentRestore, recentDump, encryptedBackup, arbitrarySql]) {
      await writeFile(path.join(directory, name), "data");
    }
    await utimes(path.join(directory, staleDump), staleDate, staleDate);
    await utimes(path.join(directory, staleRestore), staleDate, staleDate);
    for (const name of [staleBackup, staleLegacyBackup, staleJournal, unrelatedBackup]) await utimes(path.join(directory, name), staleDate, staleDate);
    await utimes(path.join(directory, recentBackup), recentDate, recentDate);
    await utimes(path.join(directory, recentRestore), recentDate, recentDate);
    await utimes(path.join(directory, recentDump), recentDate, recentDate);
    const removed = await removeStalePlaintextBackups(directory, { now, isProcessRunning: () => false });
    assert.deepEqual(removed.sort(), [staleDump, staleRestore, staleBackup, staleLegacyBackup, staleJournal].sort());
    const remaining = await readdir(directory);
    assert.deepEqual(remaining.sort(), [recentBackup, unrelatedBackup, recentRestore, recentDump, encryptedBackup, arbitrarySql].sort());
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("cleanup preserves old temporary files while their process is alive", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "food-system-active-backup-"));
  const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const live = `.backup-${process.pid}-12345678-1234-1234-1234-123456789abc.sqlite`;
  const stopped = ".restore-99999999-12345678-1234-1234-1234-123456789abc.sqlite";
  try {
    for (const name of [live, `${live}-journal`, stopped]) {
      await writeFile(path.join(directory, name), "data");
      await utimes(path.join(directory, name), old, old);
    }
    const removed = await removeStalePlaintextBackups(directory);
    assert.deepEqual(removed, [stopped]);
    assert.deepEqual((await readdir(directory)).sort(), [live, `${live}-journal`].sort());
  } finally { await rm(directory, { recursive: true, force: true }); }
});
