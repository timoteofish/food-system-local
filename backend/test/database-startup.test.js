import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

test("simultaneous first starts preserve one valid database and apply migrations once", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "food-system-startup-"));
  try {
    const env = { ...process.env, FOOD_SYSTEM_DATA_DIR: directory };
    delete env.FOOD_SYSTEM_DB_PATH;
    const starts = Array.from({ length: 8 }, () => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["--input-type=module", "-e", "const db = await import('./src/db.js'); db.closeDatabase();"], { env, stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      child.stderr.on("data", (data) => { stderr += data; });
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stderr }));
    }));
    const results = await Promise.all(starts);
    assert.deepEqual(results.filter(({ code }) => code !== 0), []);
    const db = new DatabaseSync(path.join(directory, "food-system.sqlite"), { readOnly: true });
    try {
      assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
      const migrations = (await readdir(path.join("sqlite", "migrations"))).filter((name) => /^\d+_[a-z0-9_-]+\.sql$/i.test(name));
      assert.equal(db.prepare("SELECT count(*) AS count FROM app_schema_migrations").get().count, migrations.length + 1);
    } finally { db.close(); }
    assert.deepEqual((await readdir(directory)).filter((name) => name.includes(".create-")), []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("startup refuses an unknown schema version without changing database contents", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "food-system-future-schema-"));
  try {
    const env = { ...process.env, FOOD_SYSTEM_DATA_DIR: directory };
    delete env.FOOD_SYSTEM_DB_PATH;
    const start = () => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["--input-type=module", "-e", "const db = await import('./src/db.js'); db.closeDatabase();"], { env, stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      child.stderr.on("data", (data) => { stderr += data; });
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stderr }));
    });
    assert.equal((await start()).code, 0);
    const file = path.join(directory, "food-system.sqlite");
    const db = new DatabaseSync(file);
    db.exec("INSERT INTO app_schema_migrations (version) VALUES ('999_future_version'); CREATE TABLE future_data (value TEXT); INSERT INTO future_data VALUES ('keep')");
    db.close();
    const attempt = await start();
    assert.notEqual(attempt.code, 0);
    assert.match(attempt.stderr, /unsupported schema versions: 999_future_version/);
    const unchanged = new DatabaseSync(file, { readOnly: true });
    try {
      assert.equal(unchanged.prepare("SELECT value FROM future_data").get().value, "keep");
      assert.ok(unchanged.prepare("SELECT 1 FROM app_schema_migrations WHERE version = '999_future_version'").get());
    } finally { unchanged.close(); }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("older databases gain recent operational and profile migrations without losing data", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "food-system-migration-test-"));
  try {
    const env = { ...process.env, FOOD_SYSTEM_DATA_DIR: directory };
    delete env.FOOD_SYSTEM_DB_PATH;
    const start = () => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["--input-type=module", "-e", "const db = await import('./src/db.js'); db.closeDatabase();"], { env, stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      child.stderr.on("data", (data) => { stderr += data; });
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stderr }));
    });
    const first = await start();
    assert.equal(first.code, 0, first.stderr);
    const file = path.join(directory, "food-system.sqlite");
    const db = new DatabaseSync(file);
    db.exec("DROP INDEX idx_orders_business_created_at; DROP TABLE cash_movement_idempotency; ALTER TABLE delivery_assignments DROP COLUMN failure_reason; ALTER TABLE businesses DROP COLUMN profile_phone; ALTER TABLE businesses DROP COLUMN profile_avatar; DELETE FROM app_schema_migrations WHERE version IN ('008_recent_orders_index', '009_cash_movement_idempotency', '012_delivery_failure_reason', '013_business_profile'); CREATE TABLE migration_test_marker (value TEXT); INSERT INTO migration_test_marker VALUES ('preserved')");
    db.close();
    const migrated = await start();
    assert.equal(migrated.code, 0, migrated.stderr);
    const updated = new DatabaseSync(file, { readOnly: true });
    try {
      assert.equal(updated.prepare("SELECT value FROM migration_test_marker").get().value, "preserved");
      assert.ok(updated.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_orders_business_created_at'").get());
      assert.ok(updated.prepare("SELECT 1 FROM app_schema_migrations WHERE version = '008_recent_orders_index'").get());
      assert.ok(updated.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'cash_movement_idempotency'").get());
      assert.ok(updated.prepare("SELECT 1 FROM app_schema_migrations WHERE version = '009_cash_movement_idempotency'").get());
      assert.ok(updated.prepare("SELECT 1 FROM pragma_table_info('delivery_assignments') WHERE name = 'failure_reason'").get());
      assert.ok(updated.prepare("SELECT 1 FROM app_schema_migrations WHERE version = '012_delivery_failure_reason'").get());
      assert.ok(updated.prepare("SELECT 1 FROM pragma_table_info('businesses') WHERE name = 'profile_phone'").get());
      assert.ok(updated.prepare("SELECT 1 FROM pragma_table_info('businesses') WHERE name = 'profile_avatar'").get());
      assert.ok(updated.prepare("SELECT 1 FROM app_schema_migrations WHERE version = '013_business_profile'").get());
    } finally { updated.close(); }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("recent terminal delivery lookup uses the partial ordered index", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE delivery_assignments(id TEXT PRIMARY KEY, business_id TEXT, status TEXT, updated_at TEXT)");
    db.exec(await readFile("sqlite/migrations/011_delivery_terminal_index.sql", "utf8"));
    const plan = db.prepare("EXPLAIN QUERY PLAN SELECT id FROM delivery_assignments WHERE business_id = ? AND status IN ('delivered','cancelled') ORDER BY updated_at DESC, id DESC LIMIT 50").all("business").map((row) => row.detail).join(" ");
    assert.match(plan, /idx_delivery_terminal_recent/);
    assert.doesNotMatch(plan, /TEMP B-TREE/);
  } finally { db.close(); }
});
