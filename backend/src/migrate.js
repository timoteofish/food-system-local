import { pool } from "./db.js";

try {
  const [rows] = await pool.query("SELECT version FROM app_schema_migrations ORDER BY version");
  console.log(`SQLite database ready (${rows.length} schema baseline record(s)).`);
} finally {
  await pool.end();
}
