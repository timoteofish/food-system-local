import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { loadOrCreateLocalSecret } from "../src/local-secret.js";

const localBusiness = "00000000-0000-4000-8000-000000000001";

const startInstallation = async (dataDir, extraEnv = {}) => {
  const backupDir = path.join(dataDir, "backups");
  const secret = await loadOrCreateLocalSecret({ dataDir, backupDir });
  const probe = createServer();
  await new Promise((resolve, reject) => { probe.once("error", reject); probe.listen(0, "127.0.0.1", resolve); });
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const token = randomUUID();
  const env = { ...process.env, NODE_ENV: "production", HOST: "127.0.0.1", PORT: String(port), FOOD_SYSTEM_DATA_DIR: dataDir, FOOD_SYSTEM_BACKUP_DIR: backupDir, FOOD_SYSTEM_ENV_FILE: path.join(dataDir, "test.env"), FOOD_SYSTEM_SECRET_KEY: secret, FOOD_SYSTEM_LOCAL_ACCESS_TOKEN: token, ...extraEnv };
  for (const key of ["FOOD_SYSTEM_DB_PATH", "UPDATE_URL", "UPDATE_SHA256", "UPDATE_SIGNATURE", "UPDATE_PUBLIC_KEY"]) delete env[key];
  const child = spawn(process.execPath, ["src/server.js"], { env, stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (data) => { stderr += data; });
  const base = `http://127.0.0.1:${port}/api/v1`;
  const call = async (route, { method = "GET", body, status = 200 } = {}) => {
    const response = await fetch(`${base}${route}`, { method, headers: { "X-Food-System-Local": token, ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text();
    assert.equal(response.status, status, `${method} ${route}: ${text}`);
    return JSON.parse(text);
  };
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const stopped = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGTERM");
    await stopped;
  };
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { if ((await fetch(`${base}/health`)).ok) return { call, stop }; } catch {}
    if (child.exitCode !== null || child.signalCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  await stop();
  throw new Error(`API did not start: ${stderr}`);
};

test("an encrypted backup and its original key restore on an isolated installation", { timeout: 30000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "food-offsite-recovery-"));
  const original = path.join(directory, "original");
  const replacement = path.join(directory, "replacement");
  let first;
  let second;
  try {
    first = await startInstallation(original);
    await first.call("/local/business", { method: "PUT", body: { name: "Original business" } });
    const root = `/businesses/${localBusiness}`;
    await first.call(root, { method: "PATCH", body: { description: "Original description", profile_phone: "(11) 99999-9999", profile_avatar: "data:image/png;base64,aGVsbG8=" } });
    await first.call(root, { method: "PATCH", status: 400, body: { profile_avatar: "javascript:alert(1)" } });
    await first.call(root, { method: "PATCH", status: 400, body: { profile_phone: "x".repeat(41) } });
    const category = (await first.call(`${root}/categories`, { method: "POST", status: 201, body: { name: "Meals" } })).category;
    await first.call(`${root}/products`, { method: "POST", status: 201, body: { name: "Recovery product", price: 12.5, category_id: category.id } });
    await first.call(`${root}/backups`, { method: "POST", status: 201 });
    const [name] = (await first.call(`${root}/backups`)).backups.map((entry) => entry.name);
    assert.ok(name);
    await first.stop();
    first = null;

    await mkdir(path.join(replacement, "backups"), { recursive: true });
    await copyFile(path.join(original, "backups", name), path.join(replacement, "backups", name));
    await assert.rejects(loadOrCreateLocalSecret({ dataDir: replacement, backupDir: path.join(replacement, "backups") }), /key is missing/i);
    await writeFile(path.join(replacement, "secret.key"), `${randomUUID()}${randomUUID()}\n`, { mode: 0o600 });
    second = await startInstallation(replacement);
    await second.call("/local/business", { method: "PUT", body: { name: "Temporary business" } });
    await second.call(`${root}/backups/restore`, { method: "POST", status: 500, body: { name } });
    assert.equal((await second.call(root)).business.name, "Temporary business");
    assert.equal((await readdir(path.join(replacement, "backups"))).some((entry) => entry.startsWith(".restore-")), false);
    await second.stop();
    second = null;
    await copyFile(path.join(original, "secret.key"), path.join(replacement, "secret.key"));
    second = await startInstallation(replacement);
    assert.ok((await second.call(`${root}/backups`)).backups.some((entry) => entry.name === name));
    await second.call(`${root}/backups/restore`, { method: "POST", body: { name } });
    assert.equal((await second.call(root)).business.name, "Original business");
    const provisionedAgain = await second.call("/local/business", { method: "PUT", body: { name: "Temporary business" } });
    assert.equal(provisionedAgain.business.name, "Original business");
    assert.equal(provisionedAgain.business.profile_phone, "(11) 99999-9999");
    assert.equal(provisionedAgain.business.profile_avatar, "data:image/png;base64,aGVsbG8=");
    const publicMenu = await second.call(`${root}/public`);
    assert.equal(publicMenu.profile_phone, undefined);
    assert.equal(publicMenu.profile_avatar, undefined);
    assert.equal((await second.call(root)).business.name, "Original business");
    assert.equal((await second.call(root)).business.description, "Original description");
    assert.ok((await second.call(`${root}/products`)).products.some((product) => product.name === "Recovery product" && Number(product.price) === 12.5));
    assert.ok((await readdir(path.join(replacement, "backups"))).filter((entry) => entry.endsWith(".sqlite.enc")).length >= 2);
  } finally {
    await first?.stop();
    await second?.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("API reports successful backup and restore with cleanup warnings", { timeout: 30000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "food-api-cleanup-failure-"));
  const preload = path.join(directory, "fail-cleanup.mjs");
  let installation;
  try {
    await writeFile(preload, `import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module'; const original=fs.promises.rm; fs.promises.rm=async (file, options) => { if (String(file).includes('/.backup-') && String(file).endsWith('.sqlite')) { const error=new Error('simulated cleanup failure'); error.code='EACCES'; throw error; } return original(file, options); }; syncBuiltinESMExports();`);
    installation = await startInstallation(path.join(directory, "data"), { NODE_OPTIONS: `--import=${preload}` });
    await installation.call("/local/business", { method: "PUT", body: { name: "Cleanup test" } });
    const root = `/businesses/${localBusiness}`;
    const databasePath = path.join(directory, "data", "food-system.sqlite");
    const db = new DatabaseSync(databasePath, { timeout: 5000 });
    try { db.exec("CREATE TRIGGER fail_backup_audit BEFORE INSERT ON audit_logs WHEN NEW.action IN ('backup.created','backup.restored') BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END"); }
    finally { db.close(); }
    const created = await installation.call(`${root}/backups`, { method: "POST", status: 201 });
    assert.equal(created.created, true);
    assert.equal(created.cleanup_warning, true);
    assert.equal(created.audit_recorded, false);
    const [backup] = (await installation.call(`${root}/backups`)).backups;
    const restored = await installation.call(`${root}/backups/restore`, { method: "POST", body: { name: backup.name } });
    assert.equal(restored.restored, true);
    assert.equal(restored.cleanup_warning, true);
    assert.equal(restored.audit_recorded, false);
    assert.equal((await installation.call(root)).business.name, "Cleanup test");
    const after = new DatabaseSync(databasePath, { readOnly: true });
    try { assert.equal(after.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action = ?").get("HTTP POST /api/v1/businesses/:businessId/backups/restore").n, 0); }
    finally { after.close(); }
  } finally {
    await installation?.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("API reports lack of storage without replacing current data", { timeout: 30000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "food-api-storage-full-"));
  const dataDir = path.join(directory, "data");
  const preload = path.join(directory, "full-disk.mjs");
  let installation;
  try {
    installation = await startInstallation(dataDir);
    await installation.call("/local/business", { method: "PUT", body: { name: "Before backup" } });
    const root = `/businesses/${localBusiness}`;
    await installation.call(`${root}/backups`, { method: "POST", status: 201 });
    const [backup] = (await installation.call(`${root}/backups`)).backups;
    await installation.call(root, { method: "PATCH", body: { name: "Current data" } });
    await installation.stop();
    installation = null;
    await writeFile(preload, `import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module'; const original=fs.promises.open; fs.promises.open=async (file, ...args) => { if (String(file).includes('/.backup-') && String(file).endsWith('.sqlite')) { const error=new Error('simulated disk full'); error.code='ENOSPC'; throw error; } return original(file, ...args); }; syncBuiltinESMExports();`);
    installation = await startInstallation(dataDir, { NODE_OPTIONS: `--import=${preload}` });
    const creation = await installation.call(`${root}/backups`, { method: "POST", status: 507 });
    assert.equal(creation.error, "Insufficient storage for backup");
    const restore = await installation.call(`${root}/backups/restore`, { method: "POST", status: 507, body: { name: backup.name } });
    assert.equal(restore.error, "Insufficient storage for restore");
    assert.equal((await installation.call(root)).business.name, "Current data");
  } finally {
    await installation?.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("storage failure during replacement recovers or remains in maintenance", { timeout: 30000 }, async () => {
  for (const failCount of [1, 2]) {
    const directory = await mkdtemp(path.join(tmpdir(), "food-replace-full-"));
    const dataDir = path.join(directory, "data");
    const preload = path.join(directory, "fail-replacement.mjs");
    let installation;
    try {
      installation = await startInstallation(dataDir);
      await installation.call("/local/business", { method: "PUT", body: { name: "Before backup" } });
      const root = `/businesses/${localBusiness}`;
      await installation.call(`${root}/backups`, { method: "POST", status: 201 });
      const [saved] = (await installation.call(`${root}/backups`)).backups;
      await installation.call(root, { method: "PATCH", body: { name: "Current data" } });
      await installation.stop();
      installation = null;
      await writeFile(preload, `import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module'; const original=fs.promises.rename; let remaining=${failCount}; fs.promises.rename=async (from,to) => { if (remaining > 0 && /\\/\\.(restore|recovery)-[^/]+\\.sqlite$/.test(String(from)) && String(to).endsWith('/food-system.sqlite')) { remaining--; const error=new Error('simulated disk full during replacement'); error.code='ENOSPC'; throw error; } return original(from,to); }; syncBuiltinESMExports();`);
      installation = await startInstallation(dataDir, { NODE_OPTIONS: `--import=${preload}` });
      const result = await installation.call(`${root}/backups/restore`, { method: "POST", status: 500, body: { name: saved.name } });
      if (failCount === 1) {
        assert.equal(result.error, "Restore failed due to insufficient storage; the original database was recovered");
        assert.equal((await installation.call(root)).business.name, "Current data");
      } else {
        assert.match(result.error, /API remains in maintenance/);
        await installation.call(root, { status: 503 });
        const markers = await readdir(dataDir);
        assert.ok(markers.includes("restore-recovery-required"));
        assert.ok(markers.includes("food-system.sqlite.restore-lock"));
        const database = new DatabaseSync(path.join(dataDir, "food-system.sqlite"), { readOnly: true });
        try { assert.equal(database.prepare("SELECT name FROM businesses WHERE id = ?").get(localBusiness).name, "Current data"); }
        finally { database.close(); }
      }
    } finally {
      await installation?.stop();
      await rm(directory, { recursive: true, force: true });
    }
  }
});

test("backup is not published when copied data contains broken references", { timeout: 30000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "food-invalid-backup-"));
  const dataDir = path.join(directory, "data");
  let installation;
  try {
    installation = await startInstallation(dataDir);
    await installation.call("/local/business", { method: "PUT", body: { name: "Integrity test" } });
    const root = `/businesses/${localBusiness}`;
    await installation.call(`${root}/backups`, { method: "POST", status: 201 });
    const [validBackup] = (await installation.call(`${root}/backups`)).backups;
    await installation.stop();
    installation = null;
    const db = new DatabaseSync(path.join(dataDir, "food-system.sqlite"), { enableForeignKeyConstraints: false });
    try { db.exec("INSERT INTO order_items(id,order_id,product_id,name,unit_price,quantity,total) VALUES('broken','missing-order','missing-product','Broken',1,1,1)"); }
    finally { db.close(); }
    installation = await startInstallation(dataDir);
    const result = await installation.call(`${root}/backups`, { method: "POST", status: 422 });
    assert.equal(result.error, "Backup failed integrity validation");
    const restore = await installation.call(`${root}/backups/restore`, { method: "POST", status: 409, body: { name: validBackup.name } });
    assert.equal(restore.error, "Current database failed integrity validation; a restorable safety backup could not be created");
    const backups = (await installation.call(`${root}/backups`)).backups;
    assert.deepEqual(backups.map((entry) => entry.name), [validBackup.name]);
    const check = new DatabaseSync(path.join(dataDir, "food-system.sqlite"), { readOnly: true });
    try { assert.equal(check.prepare("SELECT COUNT(*) AS total FROM order_items WHERE id='broken'").get().total, 1); }
    finally { check.close(); }
  } finally {
    await installation?.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
