import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { getMaintenancePool, pool as runtimePool } from "./db.js";
import { config } from "./config.js";
import { hasSecretKey } from "./security.js";
import { migrateLegacyIntegrationCredentials } from "./migration-secrets.js";
import { assertSelectedMariaDb } from "./database-identity.js";

const execFile = promisify(execFileCallback);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../sql");
const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = (await fs.readdir(root)).filter((file) => /^\d+_.+\.sql$/i.test(file)).sort();
const migrationLock = "food-system-schema-migrations";
const maintenancePool = getMaintenancePool();

const splitStatements = (sql) => sql
  .split(/;\s*(?:\r?\n|$)/)
  .map((statement) => statement.trim())
  .filter(Boolean);

const tableNameFrom = (statement) => statement.match(/^ALTER\s+TABLE\s+`?([\w]+)`?/i)?.[1];

const statementAlreadyApplied = async (connection, statement) => {
  const table = tableNameFrom(statement);
  if (!table) return false;
  const addColumn = statement.match(/^ALTER\s+TABLE\s+`?[\w]+`?\s+ADD\s+(?:COLUMN\s+)?`?([\w]+)`?/i);
  if (addColumn && !/^ALTER\s+TABLE\s+`?[\w]+`?\s+ADD\s+(?:UNIQUE\s+)?(?:KEY|INDEX|CONSTRAINT)\b/i.test(statement)) {
    const [rows] = await connection.query("SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ? LIMIT 1", [table, addColumn[1]]);
    return rows.length > 0;
  }
  const addIndex = statement.match(/^ALTER\s+TABLE\s+`?[\w]+`?\s+ADD\s+(?:UNIQUE\s+)?(?:KEY|INDEX)\s+`?([\w]+)`?/i);
  if (addIndex) {
    const [rows] = await connection.query("SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ? LIMIT 1", [table, addIndex[1]]);
    return rows.length > 0;
  }
  const addConstraint = statement.match(/^ALTER\s+TABLE\s+`?[\w]+`?\s+ADD\s+CONSTRAINT\s+`?([\w]+)`?/i);
  if (addConstraint) {
    const [rows] = await connection.query("SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema = DATABASE() AND table_name = ? AND constraint_name = ? LIMIT 1", [table, addConstraint[1]]);
    return rows.length > 0;
  }
  const dropColumn = statement.match(/^ALTER\s+TABLE\s+`?[\w]+`?\s+DROP\s+COLUMN\s+`?([\w]+)`?/i);
  if (dropColumn) {
    const [rows] = await connection.query("SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ? LIMIT 1", [table, dropColumn[1]]);
    return rows.length === 0;
  }
  return false;
};

let locked = false;
let connection;
try {
  connection = await maintenancePool.getConnection();
  const expectedMariaRoot = process.env.MARIADB_ROOT || "";
  if (expectedMariaRoot) {
    await assertSelectedMariaDb(connection, {
      installRoot: expectedMariaRoot,
      port: config.mysql.port,
      database: config.mysql.database,
    });
  }
  const [lockRows] = await connection.query("SELECT GET_LOCK(?, 30) AS acquired", [migrationLock]);
  if (Number(lockRows[0]?.acquired) !== 1) throw new Error("Could not acquire the schema migration lock");
  locked = true;

  const [before] = await connection.query(
    "SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name NOT IN ('schema_migrations', 'schema_migration_steps') LIMIT 1"
  );
  const isExistingInstallation = before.length > 0;
  await connection.query("CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(120) PRIMARY KEY, applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
  await connection.query("CREATE TABLE IF NOT EXISTS schema_migration_steps (version VARCHAR(120) NOT NULL, step_index INT NOT NULL, applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (version, step_index)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

  const [pending] = await connection.query("SELECT version FROM schema_migrations");
  const completed = new Set(pending.map((row) => row.version));
  const pendingFiles = files.filter((file) => !completed.has(file));
  if (isExistingInstallation && pendingFiles.length) {
    if (!hasSecretKey()) throw new Error("A backup encryption key is required before applying database migrations");
    await execFile(process.execPath, ["src/backup.js"], { cwd: backendRoot, env: process.env, windowsHide: true });
  }

  for (const file of pendingFiles) {
    const statements = splitStatements(await fs.readFile(path.join(root, file), "utf8"));
    for (let index = 0; index < statements.length; index += 1) {
      const [stepRows] = await connection.query("SELECT 1 FROM schema_migration_steps WHERE version = ? AND step_index = ? LIMIT 1", [file, index]);
      if (stepRows.length) continue;
      const statement = statements[index];
      if (!(await statementAlreadyApplied(connection, statement))) {
        if (/^ALTER\s+TABLE\s+integration_connections\s+DROP\s+COLUMN\s+credentials$/i.test(statement)) {
          if (!hasSecretKey()) throw new Error("A backup encryption key is required to migrate legacy integration credentials");
          await migrateLegacyIntegrationCredentials(connection);
        }
        await connection.query(statement);
      }
      await connection.query("INSERT IGNORE INTO schema_migration_steps (version, step_index) VALUES (?, ?)", [file, index]);
    }
    await connection.query("INSERT INTO schema_migrations (version) VALUES (?)", [file]);
    console.log(`Migration aplicada: ${file}`);
  }
} finally {
  if (locked) await connection.query("SELECT RELEASE_LOCK(?)", [migrationLock]).catch(() => {});
  connection?.release();
  await Promise.all([maintenancePool.end(), runtimePool.end()]);
}
