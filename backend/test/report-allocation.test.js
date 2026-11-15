import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

test("product discounts match exact integer allocation across varied orders", async () => {
  const source = await readFile("src/routes/reports.js", "utf8");
  const begin = source.indexOf("const [products] = await pool.query(`");
  const end = source.indexOf("`, [request.params.businessId", begin);
  assert.ok(begin >= 0 && end > begin);
  const sql = source.slice(begin + 'const [products] = await pool.query(`'.length, end);
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE orders(id TEXT, business_id TEXT, subtotal NUMERIC, discount_amount NUMERIC); CREATE TABLE order_items(id TEXT, order_id TEXT, product_id TEXT, name TEXT, quantity NUMERIC, total NUMERIC); CREATE TABLE cash_movements(order_id TEXT, business_id TEXT, type TEXT, created_at TEXT)");
    const orderInsert = db.prepare("INSERT INTO orders VALUES ('order', 'business', ?, ?)");
    const itemInsert = db.prepare("INSERT INTO order_items VALUES (?, 'order', ?, ?, 1, ?)");
    const report = db.prepare(sql);
    let state = 139;
    const next = () => { state = (state * 48271) % 2147483647; return state; };
    for (let iteration = 0; iteration < 250; iteration += 1) {
      db.exec("DELETE FROM orders; DELETE FROM order_items; DELETE FROM cash_movements; INSERT INTO cash_movements VALUES ('order', 'business', 'sale', '2026-01-01')");
      const count = 2 + next() % 8;
      const amounts = Array.from({ length: count }, () => BigInt(1 + next() % 1000000000));
      const subtotal = amounts.reduce((sum, amount) => sum + amount, 0n);
      const discount = BigInt(next()) % (subtotal + 1n);
      orderInsert.run(Number(subtotal) / 100, Number(discount) / 100);
      const allocations = amounts.map((amount, index) => {
        const id = String(index).padStart(2, "0");
        itemInsert.run(id, id, id, Number(amount) / 100);
        return { id, amount, allocated: amount * discount / subtotal, remainder: amount * discount % subtotal };
      });
      const remaining = Number(discount - allocations.reduce((sum, item) => sum + item.allocated, 0n));
      allocations.sort((a, b) => a.remainder === b.remainder ? a.id.localeCompare(b.id) : a.remainder > b.remainder ? -1 : 1);
      allocations.slice(0, remaining).forEach((item) => { item.allocated += 1n; });
      const actual = new Map(report.all("business", "2026-01-01", "2026-01-02").map((row) => [row.name, Math.round(row.revenue * 100)]));
      for (const item of allocations) assert.equal(actual.get(item.id), Number(item.amount - item.allocated), `order ${iteration}, item ${item.id}`);
    }
  } finally { db.close(); }
});
