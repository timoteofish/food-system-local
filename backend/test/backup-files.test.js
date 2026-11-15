import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createBackupName, isSafeBackupName } from "../src/backup-files.js";

test("backup name validation accepts generated UUID names and rejects paths", () => {
  assert.equal(createBackupName(new Date("2026-10-29T12:34:56.789Z"), "a1b2c3d4-e5f6-4a7b-8c9d-0123456789ab"), "food-system-2026-10-29T12-34-56-789Z-a1b2c3d4-e5f6-4a7b-8c9d-0123456789ab.sqlite.enc");
  assert.equal(isSafeBackupName("food-system-2026-10-29T12-34-56-789Z-a1b2c3d4-e5f6-4a7b-8c9d-0123456789ab.sqlite.enc"), true);
  assert.equal(isSafeBackupName("food-system-2026-10-29T12-34-56-789Z-01234567-89ab-cdef-0123-456789abcdef.sqlite.enc"), true);
  assert.equal(isSafeBackupName("../food-system-2026-10-29T12-34-56-789Z-a1b2c3d4-e5f6-4a7b-8c9d-0123456789ab.sqlite.enc"), false);
  assert.equal(isSafeBackupName("food-system-2026-10-29T12-34-56-789Z-../../backup.sqlite.enc"), false);
  assert.equal(isSafeBackupName("food-system-2026-10-29T12-34-56-789Z-a1b2c3d4-e5f6-4a7b-8c9d-0123456789ab.sql.enc"), false);
  assert.equal(isSafeBackupName(null), false);
});

test("concurrent backups with the same name do not overwrite the winner", { timeout: 30000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "food-backup-collision-"));
  const backupDir = path.join(directory, "backups");
  const env = { ...process.env, FOOD_SYSTEM_DATA_DIR: directory, FOOD_SYSTEM_BACKUP_DIR: backupDir, FOOD_SYSTEM_SECRET_KEY: "backup-collision-test-key-0123456789" };
  delete env.FOOD_SYSTEM_DB_PATH;
  delete env.FOOD_SYSTEM_INTERNAL_RESTORE_BACKUP;
  const name = createBackupName();
  const run = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["src/backup-local.js", name], { env, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (data) => { stderr += data; });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stderr }));
  });
  try {
    const results = await Promise.all([run(), run()]);
    assert.deepEqual(results.map(({ code }) => code).sort(), [0, 1]);
    assert.match(results.find(({ code }) => code !== 0).stderr, /EEXIST/);
    const output = path.join(backupDir, name);
    const saved = await readFile(output);
    assert.equal(saved.subarray(0, 4).toString(), "FSS2");
    const decrypted = path.join(directory, "verified.sqlite");
    const verification = await new Promise((resolve, reject) => {
      const script = "const {decryptFile}=await import('./src/security.js'); await decryptFile(process.env.BACKUP_TEST_INPUT, process.env.BACKUP_TEST_OUTPUT);";
      const child = spawn(process.execPath, ["--input-type=module", "-e", script], { env: { ...env, BACKUP_TEST_INPUT: output, BACKUP_TEST_OUTPUT: decrypted }, stdio: "ignore" });
      child.once("error", reject);
      child.once("close", resolve);
    });
    assert.equal(verification, 0);
    const restored = new DatabaseSync(decrypted, { readOnly: true });
    try { assert.equal(restored.prepare("PRAGMA integrity_check").get().integrity_check, "ok"); }
    finally { restored.close(); }
    const again = await run();
    assert.notEqual(again.code, 0);
    assert.deepEqual(await readFile(output), saved);
    assert.deepEqual((await readdir(backupDir)).filter((entry) => entry.endsWith(".tmp") || entry.startsWith(".backup-")), []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("a published backup reports a temporary-file cleanup failure", { timeout: 30000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "food-backup-cleanup-failure-"));
  const backupDir = path.join(directory, "backups");
  const preload = path.join(directory, "fail-cleanup.mjs");
  try {
    await writeFile(preload, `import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module'; const original=fs.promises.rm; fs.promises.rm=async (file, options) => { if (String(file).includes('/.backup-') && String(file).endsWith('.sqlite')) { const error=new Error('simulated cleanup failure'); error.code='EACCES'; throw error; } return original(file, options); }; syncBuiltinESMExports();`);
    const env = { ...process.env, FOOD_SYSTEM_DATA_DIR: directory, FOOD_SYSTEM_BACKUP_DIR: backupDir, FOOD_SYSTEM_SECRET_KEY: "backup-cleanup-test-key-0123456789" };
    delete env.FOOD_SYSTEM_DB_PATH;
    delete env.FOOD_SYSTEM_INTERNAL_RESTORE_BACKUP;
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", preload, "src/backup-local.js"], { env, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "", stderr = "";
      child.stdout.on("data", (data) => { stdout += data; });
      child.stderr.on("data", (data) => { stderr += data; });
      child.once("error", reject);
      child.once("close", (code) => resolve({ code, stdout, stderr }));
    });
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /BACKUP_CLEANUP_WARNING/);
    assert.match(result.stderr, /temporary files could not be removed/);
    const entries = await readdir(backupDir);
    assert.equal(entries.filter((name) => name.endsWith(".sqlite.enc")).length, 1);
    assert.equal(entries.filter((name) => name.startsWith(".backup-") && name.endsWith(".sqlite")).length, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
