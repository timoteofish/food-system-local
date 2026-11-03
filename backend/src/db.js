import { DatabaseSync, backup as sqliteBackup } from "node:sqlite";
import mysql from "mysql2/promise";
import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = path.join(backendRoot, "sqlite", "schema.sql");
const configuredDataDir = process.env.FOOD_SYSTEM_DATA_DIR || path.join(backendRoot, "state");
export const databasePath = path.resolve(process.env.FOOD_SYSTEM_DB_PATH || path.join(configuredDataDir, "food-system.sqlite"));
const schema = await readFile(schemaPath, "utf8");
const quoteIdentifier = (value) => `"${String(value).replaceAll('"', '""')}"`;

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
const temporaryPath = `${databasePath}.import-${process.pid}.tmp`;
if (!databaseExisted) {
  await rm(temporaryPath, { force: true });
  const fresh = new DatabaseSync(temporaryPath, { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: false });
  try {
    fresh.exec(schema);
    fresh.exec(`CREATE TABLE IF NOT EXISTS app_schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    fresh.exec(`INSERT OR IGNORE INTO app_schema_migrations (version) VALUES ('025_mariadb_schema_baseline')`);
  } finally { fresh.close(); }
  if (posix) await chmod(temporaryPath, 0o600);
  const hasLegacyConfig = Boolean(process.env.MYSQL_HOST || process.env.MYSQL_DATABASE || process.env.MYSQL_USER || process.env.MYSQL_PASSWORD);
  if (hasLegacyConfig) {
    if (!config.legacyMariaDb.password) throw new Error("Existing MariaDB settings were found, but MYSQL_PASSWORD is missing. The legacy database was not changed.");
    const source = await mysql.createConnection({ ...config.legacyMariaDb, connectTimeout: 5000, multipleStatements: false });
    try {
      await source.query("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY");
      const [state] = await source.query("SELECT COUNT(*) AS total FROM information_schema.tables WHERE table_schema = ? AND table_type = 'BASE TABLE'", [config.legacyMariaDb.database]);
      if (!Number(state[0]?.total)) throw new Error("The configured legacy MariaDB database has no tables; refusing to silently create an empty replacement.");
      const [appliedMigrations] = await source.query("SELECT version FROM schema_migrations");
      if (!appliedMigrations.some((row) => /^025_/i.test(String(row.version)))) throw new Error("The legacy MariaDB database must be upgraded through migration 025 before it can be imported. Its data was not changed.");
      const [tables] = await source.query("SELECT table_name FROM information_schema.tables WHERE table_schema = ? AND table_type = 'BASE TABLE' ORDER BY table_name", [config.legacyMariaDb.database]);
      const importer = new DatabaseSync(temporaryPath, { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: false });
      try {
        importer.exec("PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE;");
        const localTables = new Set(importer.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name));
        const counts = [];
        for (const { table_name: table } of tables) {
          if (!localTables.has(table) || ["schema_migrations", "schema_migration_steps", "app_schema_migrations"].includes(table)) continue;
          const [definitions] = await source.query(`SHOW COLUMNS FROM \`${String(table).replaceAll("`", "``")}\``);
          const columns = definitions.map((column) => column.Field);
          if (!columns.length) continue;
          const insert = importer.prepare(`INSERT INTO ${quoteIdentifier(table)} (${columns.map(quoteIdentifier).join(",")}) VALUES (${columns.map(() => "?").join(",")})`);
          let rowCount = 0;
          const rows = source.connection.query(`SELECT * FROM \`${String(table).replaceAll("`", "``")}\``).stream({ highWaterMark: 100 });
          for await (const row of rows) {
            insert.run(...columns.map((column) => {
              let value = row[column];
              if (value instanceof Date) value = value.toISOString().replace("T", " ").replace(/Z$/, "");
              if (Buffer.isBuffer(value)) value = value.toString("utf8");
              if (value !== null && typeof value === "object") value = JSON.stringify(value);
              return value === undefined ? null : value;
            }));
            rowCount += 1;
          }
          const importedCount = Number(importer.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`).get().count);
          if (importedCount !== rowCount) throw new Error(`SQLite import row count mismatch for ${table}: expected ${rowCount}, found ${importedCount}`);
          counts.push(`${table}=${rowCount}`);
        }
        importer.exec("COMMIT; PRAGMA foreign_keys = ON;");
        const violations = importer.prepare("PRAGMA foreign_key_check").all();
        if (violations.length) throw new Error(`Legacy MariaDB import failed foreign-key validation (${violations.length} violation(s)); original database remains unchanged.`);
        const integrity = importer.prepare("PRAGMA integrity_check").get();
        if (integrity.integrity_check !== "ok") throw new Error(`SQLite integrity check failed after MariaDB import: ${integrity.integrity_check}`);
        console.info(`MariaDB data imported into SQLite: ${counts.join(", ")}`);
      } catch (error) {
        try { importer.exec("ROLLBACK;"); } catch {}
        throw error;
      } finally { importer.close(); }
      await source.query("COMMIT");
    } finally { await source.end(); }
  }
  await rename(temporaryPath, databasePath);
  if (posix) await chmod(databasePath, 0o600);
}

await validateDatabaseFile(databasePath);
let db;
let databaseOpen = false;
const openDatabase = () => {
  db = new DatabaseSync(databasePath, { enableForeignKeyConstraints: true, enableDoubleQuotedStringLiterals: false, timeout: 5000 });
  db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA trusted_schema = OFF;");
  const validFoodSystemDb = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'businesses'").get();
  const hasBaseline = db.prepare("SELECT 1 FROM app_schema_migrations WHERE version = '025_mariadb_schema_baseline'").get();
  if (!validFoodSystemDb || !hasBaseline) {
    db.close();
    throw new Error("The configured SQLite file is incomplete or does not contain a Food System database; it was not modified.");
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
    if (/^\s*(?:SELECT|PRAGMA|WITH)\b/i.test(text) && !/^\s*WITH\b/i.test(text)) {
      const rows = statement.all(...values.map((value) => value === undefined ? null : value)).map((row) => Object.fromEntries(Object.entries(row).map(([name, value]) => {
        if (!/(?:_at|_for)$/i.test(name) || typeof value !== "string") return [name, value];
        const match = value.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?$/);
        if (!match) return [name, value];
        const milliseconds = (match[3] || ".000").slice(0, 4).padEnd(4, "0");
        return [name, `${match[1]}T${match[2]}${milliseconds}Z`];
      })));
      return [rows, []];
    }
    const bindings = values.map((value) => value === undefined ? null : value instanceof Date ? value.toISOString().replace("T", " ").replace(/Z$/, "") : value);
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
  try {
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    db.close();
    databaseOpen = false;
    await rm(`${databasePath}-wal`, { force: true });
    await rm(`${databasePath}-shm`, { force: true });
    await rename(databasePath, previous);
    try {
      await rename(sourcePath, databasePath);
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
  } finally { release(); }
};
