import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const run = (args, env) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, args, { cwd: root, env, stdio: "ignore" });
  child.once("error", reject);
  child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Child exited ${code}`)));
});

test("two workers claim a print job once and failed requests remain failed", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "food-print-test-"));
  const env = { ...process.env, FOOD_SYSTEM_DATA_DIR: dir, FOOD_SYSTEM_DB_PATH: path.join(dir, "test.sqlite"), PRINT_WORKER_ONCE: "true" };
  let calls = 0;
  let failure = false;
  const server = http.createServer((request, response) => {
    calls += 1;
    request.resume();
    setTimeout(() => { response.writeHead(failure ? 500 : 200); response.end(); }, 300);
  });
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    await run(["--input-type=module", "-e", "const {pool}=await import('./src/db.js'); await pool.end()"], env);
    const db = new DatabaseSync(env.FOOD_SYSTEM_DB_PATH);
    db.exec("PRAGMA foreign_keys=ON; INSERT INTO businesses(id,name,settings) VALUES('b','Test','{}'); INSERT INTO orders(id,business_id) VALUES('o','b');");
    db.prepare("INSERT INTO kitchen_stations(id,business_id,name,printer_url) VALUES('s','b','Test',?)").run(`http://127.0.0.1:${server.address().port}`);
    db.exec("INSERT INTO print_jobs(id,business_id,order_id,station_id,payload) VALUES('j','b','o','s','{}')");
    await Promise.all([run(["src/print-worker.js"], env), run(["src/print-worker.js"], env)]);
    assert.equal(calls, 1);
    assert.equal(db.prepare("SELECT status FROM print_jobs WHERE id='j'").get().status, "printed");
    failure = true;
    db.exec("UPDATE print_jobs SET status='queued', attempts=0 WHERE id='j'");
    await run(["src/print-worker.js"], env);
    const row = db.prepare("SELECT status, attempts FROM print_jobs WHERE id='j'").get();
    assert.equal(row.status, "failed");
    assert.equal(row.attempts, 1);
    db.close();
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});

test("an interrupted printer request stays marked for review and is not resent", { timeout: 30000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "food-print-interrupted-"));
  const env = { ...process.env, FOOD_SYSTEM_DATA_DIR: dir, FOOD_SYSTEM_DB_PATH: path.join(dir, "test.sqlite"), PRINT_WORKER_ONCE: "true" };
  let calls = 0;
  let received;
  const requested = new Promise((resolve) => { received = resolve; });
  const server = http.createServer((request) => { calls += 1; request.resume(); received(); });
  let db;
  let worker;
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    await run(["--input-type=module", "-e", "const {pool}=await import('./src/db.js'); await pool.end()"], env);
    db = new DatabaseSync(env.FOOD_SYSTEM_DB_PATH, { timeout: 5000 });
    db.exec("PRAGMA foreign_keys=ON; INSERT INTO businesses(id,name,settings) VALUES('b','Test','{}'); INSERT INTO orders(id,business_id) VALUES('o','b');");
    db.prepare("INSERT INTO kitchen_stations(id,business_id,name,printer_url) VALUES('s','b','Test',?)").run(`http://127.0.0.1:${server.address().port}`);
    db.exec("INSERT INTO print_jobs(id,business_id,order_id,station_id,payload) VALUES('j','b','o','s','{}')");
    worker = spawn(process.execPath, ["src/print-worker.js"], { cwd: root, env, stdio: "ignore" });
    await Promise.race([requested, new Promise((_, reject) => worker.once("exit", () => reject(new Error("Worker stopped before printer request"))))]);
    const stopped = new Promise((resolve) => worker.once("exit", resolve));
    worker.kill("SIGKILL");
    await stopped;
    const job = db.prepare("SELECT status, attempts, error_message FROM print_jobs WHERE id='j'").get();
    assert.equal(job.status, "failed");
    assert.equal(job.attempts, 1);
    assert.match(job.error_message, /outcome unknown/);
    await run(["src/print-worker.js"], env);
    assert.equal(calls, 1);
  } finally {
    if (worker && worker.exitCode === null && worker.signalCode === null) worker.kill("SIGKILL");
    db?.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});

test("a print worker refuses to start while a restore lock exists", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "food-print-restore-lock-"));
  const database = path.join(dir, "test.sqlite");
  const env = { ...process.env, FOOD_SYSTEM_DATA_DIR: dir, FOOD_SYSTEM_DB_PATH: database, PRINT_WORKER_ONCE: "true" };
  try {
    await writeFile(`${database}.restore-lock`, "", { flag: "wx" });
    await assert.rejects(run(["src/print-worker.js"], env), /Child exited/);
    const names = await readdir(dir);
    assert.equal(names.some((name) => name.startsWith("test.sqlite.print-worker-")), false);
    assert.equal(names.includes("test.sqlite"), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("worker marker is retained until another process confirms the worker has exited", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "food-print-marker-"));
  const database = path.join(dir, "test.sqlite");
  const env = { ...process.env, FOOD_SYSTEM_DATA_DIR: dir, FOOD_SYSTEM_DB_PATH: database, PRINT_WORKER_ONCE: "true" };
  try {
    await run(["src/print-worker.js"], env);
    assert.equal((await readdir(dir)).filter((name) => name.startsWith("test.sqlite.print-worker-")).length, 1);
    await run(["--input-type=module", "-e", "const {acquireRestoreGuard}=await import('./src/restore-coordination.js'); const release=await acquireRestoreGuard(); if(!release) process.exit(1); await release();"], env);
    assert.equal((await readdir(dir)).filter((name) => name.startsWith("test.sqlite.print-worker-")).length, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
