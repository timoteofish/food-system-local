import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync, backup } from "node:sqlite";

const run = (args, env) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, args, { env, stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (data) => { stderr += data; });
  child.stdout.resume();
  child.on("error", reject);
  child.on("close", (code) => resolve({ code, stderr }));
});

test("standalone restore includes committed source WAL and preserves destination on invalid source", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "food-restore-test-"));
  try {
    const env = { ...process.env, FOOD_SYSTEM_DATA_DIR: directory };
    delete env.FOOD_SYSTEM_DB_PATH;
    const initialized = await run(["--input-type=module", "-e", "const db=await import('./src/db.js'); db.closeDatabase();"], env);
    assert.equal(initialized.code, 0, initialized.stderr);
    const targetPath = path.join(directory, "food-system.sqlite");
    const original = new DatabaseSync(targetPath);
    original.exec("CREATE TABLE restore_test_marker (value TEXT); INSERT INTO restore_test_marker VALUES ('original')");
    const sourcePath = path.join(directory, "source.sqlite");
    await backup(original, sourcePath);
    original.close();
    const source = new DatabaseSync(sourcePath);
    try {
      source.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; UPDATE restore_test_marker SET value='committed in WAL'");
      assert.ok((await stat(`${sourcePath}-wal`)).size > 0);
      const restored = await run(["src/restore.js", sourcePath], env);
      assert.equal(restored.code, 0, restored.stderr);
      const target = new DatabaseSync(targetPath, { readOnly: true });
      try { assert.equal(target.prepare("SELECT value FROM restore_test_marker").get().value, "committed in WAL"); }
      finally { target.close(); }
      const invalidPath = path.join(directory, "invalid.sqlite");
      const invalid = new DatabaseSync(invalidPath);
      invalid.exec("CREATE TABLE unrelated (value TEXT)");
      invalid.close();
      assert.notEqual((await run(["src/restore.js", invalidPath], env)).code, 0);
      const futurePath = path.join(directory, "future.sqlite");
      const current = new DatabaseSync(targetPath, { readOnly: true });
      try { await backup(current, futurePath); } finally { current.close(); }
      const future = new DatabaseSync(futurePath);
      future.exec("INSERT INTO app_schema_migrations (version) VALUES ('999_future_version'); UPDATE restore_test_marker SET value='future'");
      future.close();
      const rejectedFuture = await run(["src/restore.js", futurePath], env);
      assert.notEqual(rejectedFuture.code, 0);
      assert.match(rejectedFuture.stderr, /unsupported schema versions/);
      const preserved = new DatabaseSync(targetPath, { readOnly: true });
      try { assert.equal(preserved.prepare("SELECT value FROM restore_test_marker").get().value, "committed in WAL"); }
      finally { preserved.close(); }
      assert.deepEqual((await readdir(directory)).filter((name) => name.endsWith(".restore")), []);
    } finally { source.close(); }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("standalone restore refuses an active print worker and succeeds after it stops", { timeout: 30000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "food-restore-worker-"));
  const env = { ...process.env, FOOD_SYSTEM_DATA_DIR: directory, PRINT_WORKER_ONCE: "false" };
  delete env.FOOD_SYSTEM_DB_PATH;
  let worker;
  try {
    const initialized = await run(["--input-type=module", "-e", "const db=await import('./src/db.js'); db.closeDatabase();"], env);
    assert.equal(initialized.code, 0, initialized.stderr);
    const targetPath = path.join(directory, "food-system.sqlite");
    const target = new DatabaseSync(targetPath);
    target.exec("CREATE TABLE restore_worker_marker (value TEXT); INSERT INTO restore_worker_marker VALUES ('original')");
    const sourcePath = path.join(directory, "source.sqlite");
    await backup(target, sourcePath);
    target.close();
    const source = new DatabaseSync(sourcePath);
    source.exec("UPDATE restore_worker_marker SET value='restored'");
    source.close();
    worker = spawn(process.execPath, ["src/print-worker.js"], { env, stdio: "ignore" });
    for (let i = 0; i < 200; i++) {
      if ((await readdir(directory)).some((name) => name.startsWith("food-system.sqlite.print-worker-"))) break;
      if (worker.exitCode !== null || worker.signalCode !== null) throw new Error("Print worker exited before registering");
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.ok((await readdir(directory)).some((name) => name.startsWith("food-system.sqlite.print-worker-")));
    const blocked = await run(["src/restore.js", sourcePath], env);
    assert.notEqual(blocked.code, 0);
    assert.match(blocked.stderr, /Stop API, print, backup and maintenance processes/);
    const unchanged = new DatabaseSync(targetPath, { readOnly: true });
    try { assert.equal(unchanged.prepare("SELECT value FROM restore_worker_marker").get().value, "original"); }
    finally { unchanged.close(); }
    const stopped = new Promise((resolve) => worker.once("exit", resolve));
    worker.kill("SIGTERM");
    await stopped;
    const restored = await run(["src/restore.js", sourcePath], env);
    assert.equal(restored.code, 0, restored.stderr);
    const result = new DatabaseSync(targetPath, { readOnly: true });
    try { assert.equal(result.prepare("SELECT value FROM restore_worker_marker").get().value, "restored"); }
    finally { result.close(); }
    assert.equal((await readdir(directory)).some((name) => name.endsWith(".restore-lock")), false);
  } finally {
    if (worker && worker.exitCode === null && worker.signalCode === null) worker.kill("SIGKILL");
    await rm(directory, { recursive: true, force: true });
  }
});

test("standalone backups and restores exclude one another", { timeout: 30000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "food-backup-restore-"));
  const env = { ...process.env, FOOD_SYSTEM_DATA_DIR: directory, FOOD_SYSTEM_BACKUP_DIR: path.join(directory, "backups"), FOOD_SYSTEM_SECRET_KEY: "test-backup-secret-key-0123456789" };
  delete env.FOOD_SYSTEM_DB_PATH;
  delete env.FOOD_SYSTEM_INTERNAL_RESTORE_BACKUP;
  let worker;
  try {
    const initialized = await run(["--input-type=module", "-e", "const db=await import('./src/db.js'); db.closeDatabase();"], env);
    assert.equal(initialized.code, 0, initialized.stderr);
    const targetPath = path.join(directory, "food-system.sqlite");
    const target = new DatabaseSync(targetPath);
    const sourcePath = path.join(directory, "source.sqlite");
    await backup(target, sourcePath);
    target.close();
    worker = spawn(process.execPath, ["--input-type=module", "-e", "const {registerBackupWorker}=await import('./src/restore-coordination.js'); await registerBackupWorker(); await import('./src/db.js'); setInterval(()=>{},1000);"], { env, stdio: "ignore" });
    let registered = false;
    for (let i = 0; i < 200; i++) {
      registered = (await readdir(directory)).some((name) => name.startsWith("food-system.sqlite.backup-worker-"));
      if (registered || worker.exitCode !== null) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(registered, true);
    const blocked = await run(["src/restore.js", sourcePath], env);
    assert.notEqual(blocked.code, 0);
    assert.match(blocked.stderr, /Stop API, print, backup and maintenance processes/);
    const stopped = new Promise((resolve) => worker.once("exit", resolve));
    worker.kill("SIGTERM");
    await stopped;
    const restored = await run(["src/restore.js", sourcePath], env);
    assert.equal(restored.code, 0, restored.stderr);
    assert.equal((await readdir(directory)).some((name) => name.startsWith("food-system.sqlite.backup-worker-")), false);
    await writeFile(`${targetPath}.restore-lock`, "", { flag: "wx" });
    const backupBlocked = await run(["src/backup-local.js"], env);
    assert.notEqual(backupBlocked.code, 0);
    assert.match(backupBlocked.stderr, /Database restore is in progress/);
    for (const command of ["src/init-db.js", "src/migrate.js", "src/seed.js"]) {
      const maintenanceBlocked = await run([command], env);
      assert.notEqual(maintenanceBlocked.code, 0, command);
      assert.match(maintenanceBlocked.stderr, /Database restore is in progress/);
    }
    const serverBlocked = await run(["src/server.js"], { ...env, NODE_ENV: "production", HOST: "127.0.0.1", PORT: "0", FOOD_SYSTEM_LOCAL_ACCESS_TOKEN: "local-test-token-0123456789" });
    assert.notEqual(serverBlocked.code, 0);
    assert.match(serverBlocked.stderr, /Database restore is in progress/);
  } finally {
    if (worker && worker.exitCode === null && worker.signalCode === null) worker.kill("SIGKILL");
    await rm(directory, { recursive: true, force: true });
  }
});

test("restore waits until an independent maintenance process has stopped", { timeout: 30000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "food-restore-maintenance-"));
  const env = { ...process.env, FOOD_SYSTEM_DATA_DIR: directory };
  delete env.FOOD_SYSTEM_DB_PATH;
  let worker;
  try {
    const initialized = await run(["src/init-db.js"], env);
    assert.equal(initialized.code, 0, initialized.stderr);
    const db = new DatabaseSync(path.join(directory, "food-system.sqlite"));
    const source = path.join(directory, "source.sqlite");
    await backup(db, source);
    db.close();
    worker = spawn(process.execPath, ["--input-type=module", "-e", "const {registerMaintenanceWorker}=await import('./src/restore-coordination.js'); await registerMaintenanceWorker(); await import('./src/db.js'); setInterval(()=>{},1000);"], { env, stdio: "ignore" });
    let registered = false;
    for (let i = 0; i < 200; i++) {
      registered = (await readdir(directory)).some((name) => name.startsWith(`food-system.sqlite.maintenance-worker-${worker.pid}-`));
      if (registered || worker.exitCode !== null) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(registered, true);
    const blocked = await run(["src/restore.js", source], env);
    assert.notEqual(blocked.code, 0);
    assert.match(blocked.stderr, /Stop API, print, backup and maintenance processes/);
    const stopped = new Promise((resolve) => worker.once("exit", resolve));
    worker.kill("SIGTERM");
    await stopped;
    const restored = await run(["src/restore.js", source], env);
    assert.equal(restored.code, 0, restored.stderr);
  } finally {
    if (worker && worker.exitCode === null && worker.signalCode === null) worker.kill("SIGKILL");
    await rm(directory, { recursive: true, force: true });
  }
});

test("an interrupted restore leaves an identifiable lock and prevents database access", { timeout: 30000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "food-restore-interrupted-"));
  const env = { ...process.env, FOOD_SYSTEM_DATA_DIR: directory, FOOD_SYSTEM_SECRET_KEY: "restore-interruption-test-key-0123456789" };
  delete env.FOOD_SYSTEM_DB_PATH;
  let worker;
  try {
    const initialized = await run(["src/init-db.js"], env);
    assert.equal(initialized.code, 0, initialized.stderr);
    const target = path.join(directory, "food-system.sqlite");
    const db = new DatabaseSync(target);
    db.exec("CREATE TABLE interrupted_marker (value TEXT); INSERT INTO interrupted_marker VALUES ('preserved')");
    const source = path.join(directory, "source.sqlite");
    await backup(db, source);
    db.close();
    worker = spawn(process.execPath, ["--input-type=module", "-e", "const {acquireRestoreGuard}=await import('./src/restore-coordination.js'); if(!await acquireRestoreGuard()) process.exit(1); setInterval(()=>{},1000);"], { env, stdio: "ignore" });
    let metadata;
    for (let i = 0; i < 200; i++) {
      try { metadata = JSON.parse(await readFile(`${target}.restore-lock`, "utf8")); break; }
      catch { if (worker.exitCode !== null) break; await new Promise((resolve) => setTimeout(resolve, 25)); }
    }
    assert.equal(metadata?.pid, worker.pid);
    assert.equal(metadata.source, "command");
    assert.ok(Number.isFinite(Date.parse(metadata.created_at)));
    const stopped = new Promise((resolve) => worker.once("exit", resolve));
    worker.kill("SIGKILL");
    await stopped;
    for (const args of [["src/restore.js", source], ["src/init-db.js"], ["src/server.js"]]) {
      const denied = await run(args, env);
      assert.notEqual(denied.code, 0, args[0]);
      assert.match(denied.stderr, /restore.*(progress|lock)/i);
    }
    const unchanged = new DatabaseSync(target, { readOnly: true });
    try { assert.equal(unchanged.prepare("SELECT value FROM interrupted_marker").get().value, "preserved"); }
    finally { unchanged.close(); }
    assert.equal(JSON.parse(await readFile(`${target}.restore-lock`, "utf8")).pid, worker.pid);
  } finally {
    if (worker && worker.exitCode === null && worker.signalCode === null) worker.kill("SIGKILL");
    await rm(directory, { recursive: true, force: true });
  }
});

test("maintenance commands and print worker use the configured environment file", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "food-command-config-"));
  try {
    const configuredDatabase = path.join(directory, "configured", "data.sqlite");
    const environmentFile = path.join(directory, "custom.env");
    await writeFile(environmentFile, `FOOD_SYSTEM_DB_PATH=${configuredDatabase}\nPRINT_WORKER_ONCE=true\n`);
    const env = { ...process.env, FOOD_SYSTEM_ENV_FILE: environmentFile };
    delete env.FOOD_SYSTEM_DB_PATH;
    delete env.FOOD_SYSTEM_DATA_DIR;
    delete env.PRINT_WORKER_ONCE;
    for (const command of ["src/init-db.js", "src/seed.js", "src/print-worker.js"]) {
      const result = await run([command], env);
      assert.equal(result.code, 0, result.stderr);
    }
    const db = new DatabaseSync(configuredDatabase);
    assert.equal(db.prepare("SELECT COUNT(*) AS total FROM businesses").get().total, 1);
    const source = path.join(directory, "snapshot.sqlite");
    await backup(db, source);
    db.exec("UPDATE businesses SET name='Changed after backup'");
    db.close();
    const restored = await run(["src/restore.js", source], env);
    assert.equal(restored.code, 0, restored.stderr);
    const result = new DatabaseSync(configuredDatabase, { readOnly: true });
    try { assert.equal(result.prepare("SELECT name FROM businesses").get().name, "Food System Demo"); }
    finally { result.close(); }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("database replacement supports a source on another filesystem", async (t) => {
  let externalDirectory;
  try { externalDirectory = await mkdtemp("/dev/shm/food-restore-test-"); }
  catch { t.skip("A second writable filesystem is unavailable"); return; }
  const directory = await mkdtemp(path.join(tmpdir(), "food-restore-target-"));
  try {
    if ((await stat(directory)).dev === (await stat(externalDirectory)).dev) {
      t.skip("The temporary directories share one filesystem");
      return;
    }
    const env = { ...process.env, FOOD_SYSTEM_DATA_DIR: directory };
    delete env.FOOD_SYSTEM_DB_PATH;
    const initialized = await run(["--input-type=module", "-e", "const db=await import('./src/db.js'); db.closeDatabase();"], env);
    assert.equal(initialized.code, 0, initialized.stderr);
    const targetPath = path.join(directory, "food-system.sqlite");
    const target = new DatabaseSync(targetPath);
    const sourcePath = path.join(externalDirectory, "source.sqlite");
    await backup(target, sourcePath);
    target.close();
    const source = new DatabaseSync(sourcePath);
    source.exec("CREATE TABLE restore_cross_device_marker (value TEXT); INSERT INTO restore_cross_device_marker VALUES ('restored')");
    source.close();
    if (process.platform !== "win32") await chmod(sourcePath, 0o644);
    const replace = "const db=await import('./src/db.js'); await db.replaceDatabase(process.env.SOURCE_PATH); db.closeDatabase();";
    const restored = await run(["--input-type=module", "-e", replace], { ...env, SOURCE_PATH: sourcePath });
    assert.equal(restored.code, 0, restored.stderr);
    if (process.platform !== "win32") assert.equal((await stat(targetPath)).mode & 0o777, 0o600);
    const result = new DatabaseSync(targetPath, { readOnly: true });
    try { assert.equal(result.prepare("SELECT value FROM restore_cross_device_marker").get().value, "restored"); }
    finally { result.close(); }
    assert.deepEqual((await readdir(directory)).filter((name) => name.startsWith(".restore-")), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
    await rm(externalDirectory, { recursive: true, force: true });
  }
});
