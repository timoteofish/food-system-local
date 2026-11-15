import "./load-env.js";
import { registerMaintenanceWorker } from "./restore-coordination.js";

await registerMaintenanceWorker();
const { pool } = await import("./db.js");

try {
  const [rows] = await pool.query("SELECT version FROM app_schema_migrations ORDER BY version");
  console.log(`SQLite database ready (${rows.length} schema baseline record(s)).`);
} finally {
  await pool.end();
}
