import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const read = (file) => fs.readFile(new URL(`../${file}`, import.meta.url), "utf8");
const readFrontend = (file) => fs.readFile(new URL(`../../frontend/${file}`, import.meta.url), "utf8");

test("schema contains the operational tables", async () => {
  const sql = await read("sql/001_initial.sql");
  for (const table of ["users", "businesses", "categories", "products", "restaurant_tables", "orders", "order_items", "cash_movements"]) assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
});

test("backend registers the required route groups", async () => {
  const server = await read("src/server.js");
  for (const route of ["authRoutes", "catalogRoutes", "tableRoutes", "orderRoutes", "cashRoutes"]) assert.match(server, new RegExp(`register\\(${route}\\)`));
});

test("frontend API maps Node response envelopes", async () => {
  const client = await readFrontend("shared/api/client.js");
  assert.match(client, /data\.orders \|\| \[\]/);
  assert.match(client, /data\.tables \|\| \[\]/);
  assert.match(client, /data\.movement \|\| data/);
});
