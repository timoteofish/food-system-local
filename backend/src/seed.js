import { randomUUID } from "node:crypto";
import { pool } from "./db.js";

const businessId = "00000000-0000-0000-0000-000000000001";
await pool.query("INSERT IGNORE INTO businesses (id, name, description, settings) VALUES (?, ?, ?, ?)", [businessId, "Food System Demo", "Ambiente local de demonstração", JSON.stringify({ currency: "BRL" })]);
for (const name of ["Lanches", "Bebidas", "Porções"]) {
  await pool.query("INSERT IGNORE INTO categories (id, business_id, name) SELECT ?, ?, ? FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM categories WHERE business_id = ? AND name = ?)", [randomUUID(), businessId, name, businessId, name]);
}
console.log(`Seed concluído para ${businessId}`);
await pool.end();
