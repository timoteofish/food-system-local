import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../sql");
const files = (await fs.readdir(root)).filter((file) => /^\d+_.+\.sql$/i.test(file)).sort();
await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(120) PRIMARY KEY, applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
for (const file of files) {
  const [applied] = await pool.query("SELECT version FROM schema_migrations WHERE version = ? LIMIT 1", [file]);
  if (applied.length) continue;
  const sql = await fs.readFile(path.join(root, file), "utf8");
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    for (const statement of sql.split(/;\s*(?:\r?\n|$)/).map((part) => part.trim()).filter(Boolean)) await connection.query(statement);
    await connection.query("INSERT INTO schema_migrations (version) VALUES (?)", [file]);
    await connection.commit();
    console.log(`Migration aplicada: ${file}`);
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}
await pool.end();
