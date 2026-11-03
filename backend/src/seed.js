import { randomUUID } from "node:crypto";
import { pool } from "./db.js";

const businessId = "00000000-0000-0000-0000-000000000001";
await pool.query("INSERT OR IGNORE INTO businesses (id, name, description, settings) VALUES (?, ?, ?, ?)", [businessId, "Food System Demo", "Local demo environment", JSON.stringify({ currency: "BRL" })]);
for (const name of ["Snacks", "Drinks", "Sides"]) {
  await pool.query("INSERT OR IGNORE INTO categories (id, business_id, name) SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM categories WHERE business_id = ? AND name = ?)", [randomUUID(), businessId, name, businessId, name]);
}
console.log(`Seed completed for ${businessId}`);
await pool.end();
