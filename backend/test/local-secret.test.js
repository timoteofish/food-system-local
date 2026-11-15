import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const start = (env) => new Promise((resolve, reject) => {
  const script = "const {ensureLocalSecretKey}=await import('./src/local-secret.js'); console.log(await ensureLocalSecretKey({backendRoot:process.cwd()}));";
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], { env, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (data) => { stdout += data; });
  child.stderr.on("data", (data) => { stderr += data; });
  child.on("error", reject);
  child.on("close", (code) => resolve({ code, stdout: stdout.trim(), stderr }));
});

test("concurrent development starts publish one complete encryption key", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "food-secret-test-"));
  try {
    const env = { ...process.env, NODE_ENV: "test", FOOD_SYSTEM_DATA_DIR: directory, FOOD_SYSTEM_BACKUP_DIR: path.join(directory, "backups") };
    delete env.FOOD_SYSTEM_SECRET_KEY;
    const results = await Promise.all(Array.from({ length: 12 }, () => start(env)));
    assert.deepEqual(results.filter((result) => result.code !== 0), []);
    const key = (await readFile(path.join(directory, "secret.key"), "utf8")).trim();
    assert.ok(key.length >= 32);
    assert.ok(results.every((result) => result.stdout === key));
    assert.deepEqual((await readdir(directory)).filter((name) => name.endsWith(".tmp")), []);
    assert.equal((await start(env)).stdout, key);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("missing encryption key is not regenerated when encrypted backups exist", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "food-secret-backup-test-"));
  try {
    const backups = path.join(directory, "backups");
    await mkdir(backups);
    await writeFile(path.join(backups, "existing.sqlite.enc"), "backup");
    const env = { ...process.env, NODE_ENV: "test", FOOD_SYSTEM_DATA_DIR: directory, FOOD_SYSTEM_BACKUP_DIR: backups };
    delete env.FOOD_SYSTEM_SECRET_KEY;
    const result = await start(env);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /backups exist but the local encryption key is missing/i);
    assert.equal((await readdir(directory)).includes("secret.key"), false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
