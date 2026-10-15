import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const sql = await fs.readFile(path.join(currentDir, "../sql/001_initial.sql"), "utf8");

for (const statement of sql.split(";").map((item) => item.trim()).filter(Boolean)) {
  await pool.query(statement);
}

console.log("Food System database initialized.");
await pool.end();
