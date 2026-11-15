import { DatabaseSync, backup as sqliteBackup } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, link, lstat, mkdir, open, readFile, rename, rm, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { databasePath } from "./restore-coordination.js";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = path.join(backendRoot, "sqlite", "schema.sql");
export { databasePath };
const schema = await readFile(schemaPath, "utf8");
const migrationsPath = path.join(backendRoot, "sqlite", "migrations");
const sqliteMigrations = await Promise.all((await readdir(migrationsPath)).filter((name) => /^\d+_[a-z0-9_-]+\.sql$/i.test(name)).sort().map(async (name) => ({ name, sql: await readFile(path.join(migrationsPath, name), "utf8") })));
const knownSchemaVersions = new Set(["sqlite_initial_schema", "025_mariadb_schema_baseline", ...sqliteMigrations.map(({ name }) => name.replace(/\.sql$/i, ""))]);

export const assertCompatibleSchema = (database) => {
  const tables = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(({ name }) => name));
  if (!["businesses", "users", "orders", "app_schema_migrations"].every((name) => tables.has(name))) {
    throw new Error("The SQLite file is incomplete or does not contain a Food System database.");
  }
  const versions = database.prepare("SELECT version FROM app_schema_migrations").all().map(({ version }) => version);
  const baseline = versions.find((version) => version === "sqlite_initial_schema" || version === "025_mariadb_schema_baseline");
  if (!baseline) throw new Error("The SQLite file does not contain a recognized Food System schema baseline.");
  const unknown = versions.filter((version) => !knownSchemaVersions.has(version));
  if (unknown.length) throw new Error(`The database uses unsupported schema versions: ${unknown.join(", ")}. Use a compatible application version.`);
  return baseline;
};

class Mutex {
  tail = Promise.resolve();
  async acquire() {
    let release;
    const next = new Promise((resolve) => { release = resolve; });
    const previous = this.tail;
    this.tail = previous.then(() => next);
    await previous;
    return release;
  }
}

const mutex = new Mutex();
const posix = process.platform !== "win32";
const validateDatabaseFile = async (file) => {
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("SQLite database path must be a regular file, not a symlink");
    if (posix && (info.mode & 0o077)) throw new Error("SQLite database permissions are too broad; restrict the file to its owner");
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
};

await mkdir(path.dirname(databasePath), { recursive: true, mode: 0o700 });
if (posix && !process.env.FOOD_SYSTEM_DB_PATH) await chmod(path.dirname(databasePath), 0o700);
const databaseExisted = await validateDatabaseFile(databasePath);
const temporaryPath = `${databasePath}.create-${process.pid}-${randomUUID()}.tmp`;
if (!databaseExisted) {
  try {
    const fresh = new DatabaseSync(temporaryPath, { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: false });
    try {
      fresh.exec(schema);
      fresh.exec(`CREATE TABLE IF NOT EXISTS app_schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
      fresh.exec(`INSERT OR IGNORE INTO app_schema_migrations (version) VALUES ('sqlite_initial_schema')`);
    } finally { fresh.close(); }
    if (posix) await chmod(temporaryPath, 0o600);
    try {
      // A second process may have created the database since the initial check.
      // A hard link installs the completed file atomically without replacing it.
      await link(temporaryPath, databasePath);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

await validateDatabaseFile(databasePath);
let db;
let databaseOpen = false;
const openDatabase = () => {
  db = new DatabaseSync(databasePath, { enableForeignKeyConstraints: true, enableDoubleQuotedStringLiterals: false, timeout: 5000 });
  db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA trusted_schema = OFF;");
  let baseline;
  try { baseline = assertCompatibleSchema(db); }
  catch (error) {
    db.close();
    throw error;
  }
  db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;");
  if (baseline !== "sqlite_initial_schema") {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("UPDATE app_schema_migrations SET version = 'sqlite_initial_schema' WHERE version = ?").run(baseline);
      db.exec("COMMIT");
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch {}
      db.close();
      throw error;
    }
  }
  for (const migration of sqliteMigrations) {
    const [applied] = db.prepare("SELECT version FROM app_schema_migrations WHERE version = ? LIMIT 1").all(migration.name.replace(/\.sql$/i, ""));
    if (applied) continue;
    db.exec("BEGIN IMMEDIATE");
    try {
      // Another process can finish this migration while BEGIN IMMEDIATE waits.
      const alreadyApplied = db.prepare("SELECT 1 FROM app_schema_migrations WHERE version = ? LIMIT 1").get(migration.name.replace(/\.sql$/i, ""));
      if (!alreadyApplied) {
        db.exec(migration.sql);
        db.prepare("INSERT INTO app_schema_migrations (version) VALUES (?)").run(migration.name.replace(/\.sql$/i, ""));
      }
      db.exec("COMMIT");
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch {}
      db.close();
      databaseOpen = false;
      throw new Error(`SQLite migration ${migration.name} failed: ${error.message}`, { cause: error });
    }
  }
  databaseOpen = true;
};
openDatabase();

const translateSql = (sql) => sql
  .replace(/\bNOW\s*\(\)/gi, "CURRENT_TIMESTAMP")
  .replace(/\bCURDATE\s*\(\)/gi, "date('now','localtime')")
  .replace(/DATE_ADD\(CURRENT_TIMESTAMP,\s*INTERVAL\s+\?\s+DAY\)/gi, "datetime('now', '+' || ? || ' days')")
  .replace(/CURRENT_TIMESTAMP\s*-\s*INTERVAL\s+(\d+)\s+MINUTE/gi, "datetime('now', '-$1 minutes')")
  .replace(/CURRENT_TIMESTAMP\s*-\s*INTERVAL\s+(\d+)\s+DAY/gi, "datetime('now', '-$1 days')")
  .replace(/\s+FOR\s+UPDATE\b/gi, "")
  .replace(/\bINSERT\s+IGNORE\s+INTO\b/gi, "INSERT OR IGNORE INTO")
  .replace(/\s+FROM\s+DUAL\b/gi, "");
const mapError = (error) => {
  if (error?.code === "ERR_SQLITE_ERROR" && /UNIQUE constraint failed|PRIMARY KEY constraint failed/i.test(error.message)) error.code = "ER_DUP_ENTRY";
  return error;
};
const queryOn = (sql, values = []) => {
  try {
    const text = translateSql(sql);
    const statement = db.prepare(text);
    const bindings = values.map((value) => value === undefined ? null : typeof value === "boolean" ? Number(value) : value instanceof Date ? value.toISOString().replace("T", " ").replace(/Z$/, "") : value);
    if (/^\s*(?:SELECT|PRAGMA|WITH)\b/i.test(text) && !/^\s*WITH\b/i.test(text)) {
      const rows = statement.all(...bindings).map((row) => Object.fromEntries(Object.entries(row).map(([name, value]) => {
        if (!/(?:_at|_for)$/i.test(name) || typeof value !== "string") return [name, value];
        const match = value.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?$/);
        if (!match) return [name, value];
        const milliseconds = (match[3] || ".000").slice(0, 4).padEnd(4, "0");
        return [name, `${match[1]}T${match[2]}${milliseconds}Z`];
      })));
      return [rows, []];
    }
    const result = statement.run(...bindings);
    return [{ affectedRows: Number(result.changes), insertId: Number(result.lastInsertRowid) || 0 }, []];
  } catch (error) { throw mapError(error); }
};
const pool = {
  async query(sql, values = []) {
    const release = await mutex.acquire();
    try { return queryOn(sql, values); } finally { release(); }
  },
  async getConnection() {
    let releaseLock = await mutex.acquire();
    let transaction = false;
    let released = false;
    const unlock = () => { if (releaseLock) { const release = releaseLock; releaseLock = null; release(); } };
    return {
      query: async (sql, values = []) => {
        const release = releaseLock ? null : await mutex.acquire();
        try { return queryOn(sql, values); } finally { release?.(); }
      },
      beginTransaction: async () => { if (transaction) throw new Error("Transaction already active"); if (!releaseLock) releaseLock = await mutex.acquire(); db.exec("BEGIN IMMEDIATE"); transaction = true; },
      commit: async () => { if (transaction) { db.exec("COMMIT"); transaction = false; unlock(); } },
      rollback: async () => { if (transaction) { db.exec("ROLLBACK"); transaction = false; unlock(); } },
      release: () => { if (!released) { if (transaction) { try { db.exec("ROLLBACK"); } catch {} transaction = false; } released = true; unlock(); } },
    };
  },
  async end() { if (databaseOpen) { db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); db.close(); databaseOpen = false; } },
};

export { pool };
export const getMaintenancePool = () => pool;
export const checkDatabase = async () => {
  const [rows] = await pool.query("PRAGMA quick_check");
  if (rows[0]?.quick_check !== "ok") throw new Error("SQLite database quick check failed");
};
export const createDatabaseBackup = async (destination) => sqliteBackup(db, destination);
export const closeDatabase = () => { if (databaseOpen) { db.close(); databaseOpen = false; } };
export const replaceDatabase = async (sourcePath) => {
  const release = await mutex.acquire();
  const previous = `${databasePath}.previous-${process.pid}-${randomUUID()}`;
  const crossDeviceStage = path.join(path.dirname(databasePath), `.restore-${process.pid}-${randomUUID()}.sqlite`);
  let crossDeviceStageCreated = false;
  try {
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    db.close();
    databaseOpen = false;
    await rm(`${databasePath}-wal`, { force: true });
    await rm(`${databasePath}-shm`, { force: true });
    await rename(databasePath, previous);
    try {
      try {
        await rename(sourcePath, databasePath);
      } catch (error) {
        if (error.code !== "EXDEV") throw error;
        // Prepare the replacement on the destination filesystem before publishing it.
        const destination = await open(crossDeviceStage, "wx", 0o600);
        crossDeviceStageCreated = true;
        try {
          for await (const chunk of createReadStream(sourcePath)) await destination.writeFile(chunk);
          await destination.sync();
        } finally { await destination.close(); }
        await rename(crossDeviceStage, databasePath);
      }
      if (posix) await chmod(databasePath, 0o600);
      openDatabase();
      const check = db.prepare("PRAGMA integrity_check").get();
      const foreignKeys = db.prepare("PRAGMA foreign_key_check").all();
      if (check.integrity_check !== "ok" || foreignKeys.length) throw new Error("Restored SQLite database failed integrity validation");
      await rm(previous, { force: true });
      return true;
    } catch (error) {
      try { db?.close(); } catch {}
      await rm(databasePath, { force: true });
      await rm(`${databasePath}-wal`, { force: true });
      await rm(`${databasePath}-shm`, { force: true });
      await rename(previous, databasePath);
      openDatabase();
      throw error;
    }
  } catch (error) {
    if (!databaseOpen) {
      try {
        const current = await lstat(databasePath);
        if (!current.isFile() || current.isSymbolicLink()) throw new Error("SQLite database path is not a regular file");
        openDatabase();
      } catch (reopenError) {
        error.reopenError = reopenError;
      }
    }
    throw error;
  } finally {
    try { if (crossDeviceStageCreated) await rm(crossDeviceStage, { force: true }); }
    finally { release(); }
  }
};
