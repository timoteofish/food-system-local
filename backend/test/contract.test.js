import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const read = (file) => fs.readFile(new URL(`../${file}`, import.meta.url), "utf8");
const readFrontend = (file) => fs.readFile(new URL(`../../frontend/${file}`, import.meta.url), "utf8");

test("schema contains the operational tables", async () => {
  const sql = await read("sql/001_initial.sql");
  for (const table of ["users", "businesses", "categories", "products", "restaurant_tables", "orders", "order_items", "cash_movements"]) assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
});

test("schema contains the integration boundary tables", async () => {
  const sql = await read("sql/002_integrations.sql");
  for (const table of ["integration_connections", "external_orders", "integration_events", "delivery_assignments"]) assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  assert.match(sql, /uq_external_order_provider_id/);
});

test("schema contains inventory and recipe tables", async () => {
  const sql = await read("sql/003_inventory.sql");
  for (const table of ["inventory_items", "product_ingredients", "inventory_movements"]) assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  assert.match(sql, /uq_inventory_order_item/);
});

test("schema contains operational management tables", async () => {
  const sql = await read("sql/004_operations.sql");
  for (const table of ["cash_register_sessions", "customers", "suppliers", "discounts", "loyalty_accounts"]) assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
});

test("frontend contains a kitchen display workflow", async () => {
  const page = await readFrontend("pages/app/kitchen/index.html");
  const app = await readFrontend("pages/app/kitchen/app.js");
  assert.match(page, /Kitchen display/);
  assert.match(app, /update_status/);
  assert.match(app, /preparing/);
});

test("frontend contains customer and supplier management", async () => {
  const page = await readFrontend("pages/app/contacts/index.html");
  const app = await readFrontend("pages/app/contacts/app.js");
  assert.match(page, /Customers, suppliers and loyalty/);
  assert.match(app, /\/customers/);
  assert.match(app, /\/suppliers/);
  assert.match(page, /discountForm/);
  assert.match(page, /loyaltyForm/);
  assert.match(app, /loyalty\/\$\{action\}/);
});

test("backend registers discount and loyalty routes", async () => {
  const server = await read("src/server.js");
  const routes = await read("src/routes/customer-value.js");
  assert.match(server, /register\(customerValueRoutes\)/);
  assert.match(routes, /discounts\/preview/);
  assert.match(routes, /loyalty\/redeem/);
});

test("orders persist and apply discount totals", async () => {
  const sql = await read("sql/007_order_discounts.sql");
  const routes = await read("src/routes/orders.js");
  assert.match(sql, /discount_amount/);
  assert.match(routes, /Invalid or expired discount code/);
  assert.match(routes, /discountCode/);
});

test("reports backend is registered", async () => {
  const server = await read("src/server.js");
  const routes = await read("src/routes/reports.js");
  assert.match(server, /register\(reportRoutes\)/);
  assert.match(routes, /reports\/sales/);
  assert.match(routes, /critical-stock/);
});

test("reports frontend exists", async () => {
  const page = await readFrontend("pages/app/reports/index.html");
  const app = await readFrontend("pages/app/reports/app.js");
  assert.match(page, /Reports/);
  assert.match(app, /reports\/sales/);
});

test("backup routes validate safe backup names", async () => {
  const routes = await read("src/routes/backups.js");
  const page = await readFrontend("pages/app/backups/index.html");
  assert.match(routes, /safeName/);
  assert.match(routes, /Restore failed/);
  assert.match(page, /Create backup/);
});

test("inventory frontend exposes movement and recipe workflows", async () => {
  const page = await readFrontend("pages/app/inventory/index.html");
  const app = await readFrontend("pages/app/inventory/app.js");
  assert.match(page, /Stock movement/);
  assert.match(page, /Product recipe/);
  assert.match(app, /inventory\/items/);
  assert.match(app, /\/recipe/);
});

test("order printing is available in backend and kitchen frontend", async () => {
  const routes = await read("src/routes/orders.js");
  const app = await readFrontend("pages/app/kitchen/app.js");
  assert.match(routes, /orders\/:id\/print/);
  assert.match(app, /data-print-order/);
  assert.match(app, /window\.print/);
});

test("cashier frontend exposes register session controls", async () => {
  const page = await readFrontend("pages/app/cashier/index.html");
  const app = await readFrontend("pages/app/cashier/app.js");
  assert.match(page, /cashRegisterForm/);
  assert.match(app, /openCashRegister/);
  assert.match(app, /closeCashRegister/);
});

test("cashier frontend exposes supply and withdrawal controls", async () => {
  const page = await readFrontend("pages/app/cashier/index.html");
  const app = await readFrontend("pages/app/cashier/app.js");
  assert.match(page, /movementForm/);
  assert.match(page, /withdrawal/);
  assert.match(app, /createCashMovement/);
});

test("backend registers the required route groups", async () => {
  const server = await read("src/server.js");
  for (const route of ["authRoutes", "catalogRoutes", "tableRoutes", "diningTabRoutes", "orderRoutes", "cashRoutes", "integrationRoutes", "inventoryRoutes", "operationsRoutes"]) assert.match(server, new RegExp(`register\\(${route}\\)`));
});

test("dining tabs provide advanced table service controls", async () => {
  const routes = await read("src/routes/dining-tabs.js");
  const page = await readFrontend("pages/app/tables/index.html");
  const app = await readFrontend("pages/app/tables/app.js");
  assert.match(routes, /dining-tabs/);
  assert.match(routes, /transfer/);
  assert.match(routes, /close/);
  assert.match(page, /Tables and tabs/);
  assert.match(app, /openDiningTab/);
});

test("fiscal workflow is explicit and refuses unconfigured issuance", async () => {
  const server = await read("src/server.js");
  const routes = await read("src/routes/fiscal.js");
  const page = await readFrontend("pages/app/fiscal/index.html");
  assert.match(server, /register\(fiscalRoutes\)/);
  assert.match(routes, /FISCAL_PROVIDER_URL/);
  assert.match(routes, /certificate credentials/);
  assert.match(page, /Fiscal documents/);
});

test("legacy screens expose a persistent language control", async () => {
  for (const pageName of ["dashboard", "cashier", "orders", "products", "menu", "team", "user-edit"]) {
    const page = await readFrontend(`pages/app/${pageName}/index.html`);
    assert.match(page, /data-global-language/);
    assert.match(page, /legacy-control\.js/);
  }
});

test("integration routes expose connection and event boundaries", async () => {
  const routes = await read("src/routes/integrations.js");
  assert.match(routes, /app\.post\("\/api\/v1\/businesses\/:businessId\/integrations"/);
  assert.match(routes, /external-orders/);
  assert.match(routes, /event_type is required/);
  assert.match(routes, /order\.received/);
  assert.match(routes, /external_order_id/);
  assert.match(routes, /secure storage is configured/);
});

test("frontend API maps Node response envelopes", async () => {
  const client = await readFrontend("shared/api/client.js");
  assert.match(client, /data\.orders \|\| \[\]/);
  assert.match(client, /data\.tables \|\| \[\]/);
  assert.match(client, /data\.movement \|\| data/);
});
