import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
const enabled = Boolean(process.env.FOOD_SYSTEM_API_URL && !process.env.FOOD_SYSTEM_TEST_AUTO_DATA_DIR && (process.env.FOOD_SYSTEM_DATA_DIR || process.env.FOOD_SYSTEM_DB_PATH));
const integrationTest = enabled ? test : test.skip;
const { pool, databasePath } = enabled ? await import("../src/db.js") : { pool: null, databasePath: null };
const base = process.env.FOOD_SYSTEM_API_URL || "";
const request = async (path, options = {}) => {
  if ((options.method || "GET").toUpperCase() === "POST" && /\/orders$/.test(path) && typeof options.body === "string") {
    const body = JSON.parse(options.body);
    body.idempotency_key ||= randomUUID();
    options = { ...options, body: JSON.stringify(body) };
  }
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { ...(options.body === undefined ? {} : { "Content-Type": "application/json" }), ...(options.headers || {}) },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  assert.equal(response.ok, true, `${options.method || "GET"} ${path}: ${response.status} ${text}`);
  return data;
};

test.after(async () => {
  await pool?.end();
});

integrationTest("API completes the local restaurant operation flow", async () => {
  const health = await request("/health");
  assert.deepEqual(health, { status: "ok", database: "ok" });

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const registered = await request("/auth/register", {
    method: "POST",
    body: JSON.stringify({ email: `integration-${suffix}@example.test`, name: "Integration Owner", password: "SecurePassword123" }),
  });
  assert.ok(registered.token);
  const auth = { Authorization: `Bearer ${registered.token}` };
  const businessId = registered.business.id;

  const profile = await request("/auth/profile", { headers: auth });
  assert.equal(profile.user.email, registered.user.email);

  const category = await request(`/businesses/${businessId}/categories`, {
    method: "POST", headers: auth, body: JSON.stringify({ name: "Integration" }),
  });
  const product = await request(`/businesses/${businessId}/products`, {
    method: "POST", headers: auth, body: JSON.stringify({ name: "Test product", price: 12.5, category_id: category.category.id }),
  });
  const table = await request(`/businesses/${businessId}/tables`, {
    method: "POST", headers: auth, body: JSON.stringify({ name: "Integration table" }),
  });
  await request(`/businesses/${businessId}`, {
    method: "PATCH", headers: auth,
    body: JSON.stringify({ settings: { gradient_start: "#112233", gradient_end: "#334455", gradient_angle: 45, menu_banner: "Welcome", show_all_products: false, selected_categories: ["Integration"], api_token: "must-not-be-public" } }),
  });
  const menu = await request(`/menu/${table.table.public_token}`);
  assert.equal(menu.table.id, table.table.id);
  assert.equal(menu.categories[0].products[0].id, product.product.id);
  assert.equal(menu.business_id, businessId);
  assert.equal(menu.business_name, registered.business.name);
  assert.equal(menu.products[0].id, product.product.id);
  assert.equal(menu.gradient_start, "#112233");
  assert.deepEqual(menu.selected_categories, ["Integration"]);
  assert.equal(menu.api_token, undefined);
  assert.equal(menu.settings, undefined);
  const directMenu = await request(`/businesses/${businessId}/public`);
  assert.equal(directMenu.business_id, businessId);
  assert.equal(directMenu.products[0].id, product.product.id);
  assert.equal(directMenu.api_token, undefined);
  assert.equal(directMenu.settings, undefined);

  const order = await request(`/businesses/${businessId}/orders`, {
    method: "POST", body: JSON.stringify({ table_token: table.table.public_token, items: [{ product_id: product.product.id, quantity: 2 }] }),
  });
  assert.equal(order.order.total, 25);
  const completedOrder = await request(`/businesses/${businessId}/orders`, {
    method: "POST", body: JSON.stringify({ table_token: table.table.public_token, items: [{ product_id: product.product.id, quantity: 1 }] }),
  });
  await pool.query("UPDATE orders SET status = 'completed' WHERE id = ?", [completedOrder.order.id]);
  const kitchenOrders = await request(`/businesses/${businessId}/orders?view=kitchen`, { headers: auth });
  assert.deepEqual(kitchenOrders.orders.map(({ id }) => id), [order.order.id]);
  assert.equal(kitchenOrders.orders[0].items[0].name, "Test product");
  const activeOrders = await request(`/businesses/${businessId}/orders?view=active`, { headers: auth });
  assert.deepEqual(activeOrders.orders.map(({ id }) => id), [order.order.id]);
  const allOrders = await request(`/businesses/${businessId}/orders`, { headers: auth });
  assert.equal(allOrders.orders.length, 2);
  await assert.rejects(request(`/businesses/${businessId}/orders?view=kitchen&status=completed`, { headers: auth }), /400/);
  const ticket = await request(`/businesses/${businessId}/orders/${order.order.id}/print`, { headers: auth });
  assert.equal(ticket.ticket.items[0].name, "Test product");
  const printJob = await request(`/businesses/${businessId}/orders/${order.order.id}/print-jobs`, { method: "POST", headers: auth, body: JSON.stringify({}) });
  assert.equal(printJob.job.status, "queued");

  const updated = await request(`/businesses/${businessId}/orders/${order.order.id}/update_status`, {
    method: "PATCH", headers: auth, body: JSON.stringify({ status: "confirmed" }),
  });
  assert.equal(updated.order.status, "confirmed");

  await request(`/businesses/${businessId}/cash-register/open`, {
    method: "POST", headers: auth, body: JSON.stringify({ opening_amount: 0 }),
  });

  const movement = await request(`/businesses/${businessId}/cash_movements`, {
    method: "POST", headers: auth, body: JSON.stringify({ type: "entry", amount: 25, description: "Integration" }),
  });
  assert.equal(movement.movement.amount, 25);

  const team = await request(`/businesses/${businessId}/team`, { headers: auth });
  assert.equal(team.members.length, 1);
});

integrationTest("recent order view returns only the three newest orders for the business", async () => {
  const registered = await request("/auth/register", { method: "POST", body: JSON.stringify({ email: `recent-${randomUUID()}@example.test`, name: "Recent Owner", password: "SecurePassword123" }) });
  const headers = { Authorization: `Bearer ${registered.token}` };
  const id = registered.business.id;
  const category = (await request(`/businesses/${id}/categories`, { method: "POST", headers, body: JSON.stringify({ name: "Meals" }) })).category;
  const product = (await request(`/businesses/${id}/products`, { method: "POST", headers, body: JSON.stringify({ name: "Meal", price: 10, category_id: category.id }) })).product;
  const ids = [];
  for (let index = 0; index < 5; index += 1) {
    const order = (await request(`/businesses/${id}/orders`, { method: "POST", body: JSON.stringify({ items: [{ product_id: product.id, quantity: 1 }] }) })).order;
    ids.push(order.id);
    await pool.query("UPDATE orders SET created_at = ? WHERE id = ?", [`2026-01-0${index + 1} 12:00:00`, order.id]);
  }
  await pool.query("UPDATE orders SET status = 'completed' WHERE id = ?", [ids[4]]);
  const recent = await request(`/businesses/${id}/orders?view=recent`, { headers });
  assert.deepEqual(recent.orders.map((order) => order.id), [ids[4], ids[3], ids[2]]);
  assert.equal(recent.orders[0].items[0].name, "Meal");
  const inspection = new DatabaseSync(databasePath, { readOnly: true });
  let plan;
  try { plan = inspection.prepare("EXPLAIN QUERY PLAN SELECT id FROM orders WHERE business_id = ? ORDER BY created_at DESC, id DESC LIMIT 3").all(id); }
  finally { inspection.close(); }
  assert.ok(plan.some((step) => step.detail.includes("idx_orders_business_created_at")));
  assert.equal((await request(`/businesses/${id}/orders?view=active`, { headers })).orders.length, 4);
  assert.equal((await request(`/businesses/${id}/orders`, { headers })).orders.length, 5);
});

integrationTest("deactivated products and categories cannot be ordered, while previous orders remain", async () => {
  const suffix = randomUUID();
  const registered = await request('/auth/register', { method: 'POST', body: JSON.stringify({ email: `catalog-${suffix}@example.test`, name: 'Catalog Owner', password: 'SecurePassword123' }) });
  const id = registered.business.id;
  const headers = { Authorization: `Bearer ${registered.token}` };
  const category = (await request(`/businesses/${id}/categories`, { method: 'POST', headers, body: JSON.stringify({ name: 'Category' }) })).category;
  const product = (await request(`/businesses/${id}/products`, { method: 'POST', headers, body: JSON.stringify({ name: 'Product', price: 10, category_id: category.id }) })).product;
  const order = () => request(`/businesses/${id}/orders`, { method: 'POST', body: JSON.stringify({ items: [{ product_id: product.id, quantity: 1 }] }) });
  await order();
  await request(`/businesses/${id}/products/${product.id}`, { method: 'PATCH', headers, body: JSON.stringify({ active: false }) });
  await assert.rejects(order(), /400/);
  await request(`/businesses/${id}/products/${product.id}`, { method: 'PATCH', headers, body: JSON.stringify({ active: true }) });
  await request(`/businesses/${id}/categories/${category.id}`, { method: 'PATCH', headers, body: JSON.stringify({ active: false }) });
  await assert.rejects(order(), /400/);
  const orders = await request(`/businesses/${id}/orders`, { headers });
  assert.equal(orders.orders.length, 1);
  assert.equal(orders.orders[0].items[0].name, 'Product');
});

integrationTest("fractional stock reservations are precise and direct completion cannot consume another order's reservation", async () => {
  const registered = await request("/auth/register", { method: "POST", body: JSON.stringify({ email: `fractional-${randomUUID()}@example.test`, name: "Fractional Owner", password: "SecurePassword123" }) });
  const headers = { Authorization: `Bearer ${registered.token}` };
  const id = registered.business.id;
  const category = (await request(`/businesses/${id}/categories`, { method: "POST", headers, body: JSON.stringify({ name: "Food" }) })).category;
  const product = (await request(`/businesses/${id}/products`, { method: "POST", headers, body: JSON.stringify({ name: "Meal", price: 10, category_id: category.id }) })).product;
  const item = (await request(`/businesses/${id}/inventory/items`, { method: "POST", headers, body: JSON.stringify({ name: "Flour", unit: "kg", current_quantity: 0.3 }) })).item;
  await request(`/businesses/${id}/products/${product.id}/recipe`, { method: "PUT", headers, body: JSON.stringify({ ingredients: [{ inventory_item_id: item.id, quantity: 0.1 }] }) });
  const makeOrder = async (quantity) => (await request(`/businesses/${id}/orders`, { method: "POST", body: JSON.stringify({ items: [{ product_id: product.id, quantity }] }) })).order;
  const update = (order, status) => request(`/businesses/${id}/orders/${order.id}/update_status`, { method: "PATCH", headers, body: JSON.stringify({ status }) });
  const first = await makeOrder(2);
  const second = await makeOrder(1);
  const third = await makeOrder(2);
  await update(first, "confirmed");
  await assert.rejects(update(third, "completed"), /409/);
  await update(second, "confirmed");
  await assert.rejects(update(third, "completed"), /409/);
  await update(second, "completed");
  await update(first, "completed");
  const [lots] = await pool.query("SELECT current_quantity, status FROM inventory_lots WHERE inventory_item_id = ?", [item.id]);
  assert.equal(Number(lots[0].current_quantity), 0);
  assert.equal(lots[0].status, "depleted");
  const [saved] = await pool.query("SELECT status FROM orders WHERE id = ?", [third.id]);
  assert.equal(saved[0].status, "pending");
});

integrationTest("shared ingredient demand is rounded once and tiny quantities cannot silently consume zero", async () => {
  const registered = await request("/auth/register", { method: "POST", body: JSON.stringify({ email: `recipe-round-${randomUUID()}@example.test`, name: "Recipe Owner", password: "SecurePassword123" }) });
  const headers = { Authorization: `Bearer ${registered.token}` };
  const id = registered.business.id;
  const category = (await request(`/businesses/${id}/categories`, { method: "POST", headers, body: JSON.stringify({ name: "Meals" }) })).category;
  const item = (await request(`/businesses/${id}/inventory/items`, { method: "POST", headers, body: JSON.stringify({ name: "Ingredient", unit: "kg", current_quantity: 0.01 }) })).item;
  const products = [];
  for (const name of ["First", "Second"]) {
    const product = (await request(`/businesses/${id}/products`, { method: "POST", headers, body: JSON.stringify({ name, price: 10, category_id: category.id }) })).product;
    await request(`/businesses/${id}/products/${product.id}/recipe`, { method: "PUT", headers, body: JSON.stringify({ ingredients: [{ inventory_item_id: item.id, quantity: 0.001 }] }) });
    products.push(product);
  }
  const order = (await request(`/businesses/${id}/orders`, { method: "POST", body: JSON.stringify({ items: products.map((product) => ({ product_id: product.id, quantity: 0.5 })) }) })).order;
  await request(`/businesses/${id}/orders/${order.id}/update_status`, { method: "PATCH", headers, body: JSON.stringify({ status: "confirmed" }) });
  const [reservation] = await pool.query("SELECT ri.quantity FROM inventory_reservation_items ri JOIN inventory_reservations r ON r.id = ri.reservation_id WHERE r.order_id = ?", [order.id]);
  assert.equal(Number(reservation[0].quantity), 0.001);
  await request(`/businesses/${id}/orders/${order.id}/update_status`, { method: "PATCH", headers, body: JSON.stringify({ status: "completed" }) });
  const [stock] = await pool.query("SELECT current_quantity FROM inventory_items WHERE id = ?", [item.id]);
  assert.equal(Number(stock[0].current_quantity), 0.009);
  const tiny = (await request(`/businesses/${id}/orders`, { method: "POST", body: JSON.stringify({ items: [{ product_id: products[0].id, quantity: 0.01 }] }) })).order;
  await assert.rejects(request(`/businesses/${id}/orders/${tiny.id}/update_status`, { method: "PATCH", headers, body: JSON.stringify({ status: "completed" }) }), /409/);
  const [unchanged] = await pool.query("SELECT status FROM orders WHERE id = ?", [tiny.id]);
  assert.equal(unchanged[0].status, "pending");
});

integrationTest("fractional receiving and adjustments preserve exact quantities and reservations", async () => {
  const registered = await request("/auth/register", { method: "POST", body: JSON.stringify({ email: `fractional-move-${randomUUID()}@example.test`, name: "Inventory Owner", password: "SecurePassword123" }) });
  const headers = { Authorization: `Bearer ${registered.token}` };
  const id = registered.business.id;
  const item = (await request(`/businesses/${id}/inventory/items`, { method: "POST", headers, body: JSON.stringify({ name: "Ingredient", unit: "kg", current_quantity: 0 }) })).item;
  const purchase = (await request(`/businesses/${id}/inventory/purchase-orders`, { method: "POST", headers, body: JSON.stringify({ location_id: item.location_id, items: [{ inventory_item_id: item.id, quantity: 0.3, unit_cost: 10 }] }) })).purchase_order;
  const list = await request(`/businesses/${id}/inventory/purchase-orders`, { headers });
  const line = list.purchase_orders.find((row) => row.id === purchase.id).items[0];
  const receive = (quantity) => request(`/businesses/${id}/inventory/purchase-orders/${purchase.id}/receipts`, { method: "POST", headers: { ...headers, "Idempotency-Key": randomUUID() }, body: JSON.stringify({ items: [{ order_item_id: line.id, quantity, lot_code: "FRACTIONAL" }] }) });
  await receive(0.1);
  await receive(0.2);
  const [purchaseLines] = await pool.query("SELECT received_quantity FROM inventory_purchase_order_items WHERE id = ?", [line.id]);
  assert.equal(Number(purchaseLines[0].received_quantity), 0.3);
  const [orders] = await pool.query("SELECT status FROM inventory_purchase_orders WHERE id = ?", [purchase.id]);
  assert.equal(orders[0].status, "received");
  const category = (await request(`/businesses/${id}/categories`, { method: "POST", headers, body: JSON.stringify({ name: "Food" }) })).category;
  const product = (await request(`/businesses/${id}/products`, { method: "POST", headers, body: JSON.stringify({ name: "Meal", price: 10, category_id: category.id }) })).product;
  await request(`/businesses/${id}/products/${product.id}/recipe`, { method: "PUT", headers, body: JSON.stringify({ ingredients: [{ inventory_item_id: item.id, quantity: 0.1 }] }) });
  const order = (await request(`/businesses/${id}/orders`, { method: "POST", body: JSON.stringify({ items: [{ product_id: product.id, quantity: 1 }] }) })).order;
  await request(`/businesses/${id}/orders/${order.id}/update_status`, { method: "PATCH", headers, body: JSON.stringify({ status: "confirmed" }) });
  await request(`/businesses/${id}/inventory/items/${item.id}/movements`, { method: "POST", headers, body: JSON.stringify({ type: "loss", quantity: 0.2, location_id: item.location_id }) });
  await request(`/businesses/${id}/orders/${order.id}/update_status`, { method: "PATCH", headers, body: JSON.stringify({ status: "completed" }) });
  const [lots] = await pool.query("SELECT current_quantity, status FROM inventory_lots WHERE inventory_item_id = ?", [item.id]);
  assert.equal(Number(lots[0].current_quantity), 0);
  assert.equal(lots[0].status, "depleted");
});

integrationTest("orders cannot reserve or consume stock in an inactive location", async () => {
  const suffix = randomUUID();
  const registered = await request('/auth/register', { method: 'POST', body: JSON.stringify({ email: `stock-location-${suffix}@example.test`, name: 'Stock Owner', password: 'SecurePassword123' }) });
  const id = registered.business.id;
  const headers = { Authorization: `Bearer ${registered.token}` };
  const category = (await request(`/businesses/${id}/categories`, { method: 'POST', headers, body: JSON.stringify({ name: 'Category' }) })).category;
  const product = (await request(`/businesses/${id}/products`, { method: 'POST', headers, body: JSON.stringify({ name: 'Product', price: 10, category_id: category.id }) })).product;
  const item = (await request(`/businesses/${id}/inventory/items`, { method: 'POST', headers, body: JSON.stringify({ name: 'Ingredient', unit: 'unit', current_quantity: 10 }) })).item;
  await request(`/businesses/${id}/products/${product.id}/recipe`, { method: 'PUT', headers, body: JSON.stringify({ ingredients: [{ inventory_item_id: item.id, quantity: 1 }] }) });
  const production = (await request(`/businesses/${id}/inventory/production-orders`, { method: 'POST', headers, body: JSON.stringify({ product_id: product.id, location_id: item.location_id, batch_code: randomUUID(), planned_quantity: 1 }) })).production_order;
  const purchase = (await request(`/businesses/${id}/inventory/purchase-orders`, { method: 'POST', headers, body: JSON.stringify({ location_id: item.location_id, items: [{ inventory_item_id: item.id, quantity: 2, unit_cost: 1 }] }) })).purchase_order;
  const purchaseList = await request(`/businesses/${id}/inventory/purchase-orders`, { headers });
  const purchaseLine = purchaseList.purchase_orders.find((row) => row.id === purchase.id).items[0];
  const destination = (await request(`/businesses/${id}/inventory/locations`, { method: 'POST', headers, body: JSON.stringify({ name: 'Destination', code: 'DEST' }) })).location;
  const transfer = (await request(`/businesses/${id}/inventory/transfers`, { method: 'POST', headers, body: JSON.stringify({ from_location_id: item.location_id, to_location_id: destination.id, items: [{ inventory_item_id: item.id, quantity: 1 }] }) })).transfer;
  const count = (await request(`/businesses/${id}/inventory/stock-counts`, { method: 'POST', headers, body: JSON.stringify({ location_id: item.location_id }) })).stock_count;
  const submitted = (await request(`/businesses/${id}/inventory/stock-counts`, { method: 'POST', headers, body: JSON.stringify({ location_id: item.location_id }) })).stock_count;
  await request(`/businesses/${id}/inventory/stock-counts/${submitted.id}`, { method: 'PATCH', headers, body: JSON.stringify({ status: 'submitted', items: [{ inventory_item_id: item.id, counted_quantity: 9 }] }) });
  const started = (await request(`/businesses/${id}/inventory/production-orders`, { method: 'POST', headers, body: JSON.stringify({ product_id: product.id, location_id: item.location_id, batch_code: randomUUID(), planned_quantity: 1 }) })).production_order;
  await request(`/businesses/${id}/inventory/production-orders/${started.id}`, { method: 'PATCH', headers, body: JSON.stringify({ status: 'in_progress' }) });
  await pool.query('UPDATE inventory_locations SET active = FALSE WHERE id = ? AND business_id = ?', [item.location_id, id]);
  const listedItems = await request(`/businesses/${id}/inventory/items`, { headers });
  assert.equal(Number(listedItems.items.find((row) => row.id === item.id).current_quantity), 0);
  await assert.rejects(request(`/businesses/${id}/inventory/stock-counts/${count.id}`, { method: 'PATCH', headers, body: JSON.stringify({ status: 'submitted', items: [{ inventory_item_id: item.id, counted_quantity: 9 }] }) }), /Stock count location is inactive/);
  await assert.rejects(request(`/businesses/${id}/inventory/stock-counts/${submitted.id}`, { method: 'PATCH', headers, body: JSON.stringify({ status: 'approved' }) }), /Stock count location is inactive/);
  await assert.rejects(request(`/businesses/${id}/inventory/transfers/${transfer.id}`, { method: 'PATCH', headers, body: JSON.stringify({ status: 'in_transit' }) }), /409/);
  await request(`/businesses/${id}/inventory/transfers/${transfer.id}`, { method: 'PATCH', headers, body: JSON.stringify({ status: 'cancelled' }) });
  await assert.rejects(request(`/businesses/${id}/inventory/purchase-orders/${purchase.id}/receipts`, { method: 'POST', headers: { ...headers, 'Idempotency-Key': randomUUID() }, body: JSON.stringify({ items: [{ order_item_id: purchaseLine.id, quantity: 1 }] }) }), /409/);
  await assert.rejects(request(`/businesses/${id}/inventory/production-orders/${production.id}`, { method: 'PATCH', headers, body: JSON.stringify({ status: 'in_progress' }) }), /409/);
  await request(`/businesses/${id}/inventory/production-orders/${production.id}`, { method: 'PATCH', headers, body: JSON.stringify({ status: 'cancelled' }) });
  await assert.rejects(request(`/businesses/${id}/inventory/production-orders/${started.id}`, { method: 'PATCH', headers, body: JSON.stringify({ status: 'completed', actual_quantity: 1 }) }), /409/);
  await request(`/businesses/${id}/inventory/production-orders/${started.id}`, { method: 'PATCH', headers, body: JSON.stringify({ status: 'cancelled' }) });
  const order = (await request(`/businesses/${id}/orders`, { method: 'POST', body: JSON.stringify({ items: [{ product_id: product.id, quantity: 1 }] }) })).order;
  const status = (value) => request(`/businesses/${id}/orders/${order.id}/update_status`, { method: 'PATCH', headers, body: JSON.stringify({ status: value }) });
  await assert.rejects(status('confirmed'), /409/);
  await assert.rejects(status('completed'), /409/);
  const [lots] = await pool.query('SELECT current_quantity FROM inventory_lots WHERE inventory_item_id = ?', [item.id]);
  assert.equal(Number(lots[0].current_quantity), 10);
});

integrationTest("finished stock in inactive locations is not reserved or consumed", async () => {
  const registered = await request('/auth/register', { method: 'POST', body: JSON.stringify({ email: `finished-${randomUUID()}@example.test`, name: 'Stock Owner', password: 'SecurePassword123' }) });
  const id = registered.business.id;
  const headers = { Authorization: `Bearer ${registered.token}` };
  const category = (await request(`/businesses/${id}/categories`, { method: 'POST', headers, body: JSON.stringify({ name: 'Category' }) })).category;
  const product = (await request(`/businesses/${id}/products`, { method: 'POST', headers, body: JSON.stringify({ name: 'Product', price: 10, category_id: category.id }) })).product;
  const ingredient = (await request(`/businesses/${id}/inventory/items`, { method: 'POST', headers, body: JSON.stringify({ name: 'Ingredient', unit: 'unit', current_quantity: 10 }) })).item;
  await request(`/businesses/${id}/products/${product.id}/recipe`, { method: 'PUT', headers, body: JSON.stringify({ ingredients: [{ inventory_item_id: ingredient.id, quantity: 1 }] }) });
  const location = (await request(`/businesses/${id}/inventory/locations`, { method: 'POST', headers, body: JSON.stringify({ name: 'Inactive location', code: 'INACTIVE' }) })).location;
  const productionId = randomUUID(), lotId = randomUUID();
  await pool.query("INSERT INTO production_orders (id, business_id, product_id, location_id, batch_code, planned_quantity, status) VALUES (?, ?, ?, ?, ?, 5, 'completed')", [productionId, id, product.id, location.id, randomUUID()]);
  await pool.query("INSERT INTO inventory_product_lots (id, business_id, product_id, location_id, production_order_id, batch_code, produced_quantity, current_quantity) VALUES (?, ?, ?, ?, ?, ?, 5, 5)", [lotId, id, product.id, location.id, productionId, randomUUID()]);
  await pool.query('UPDATE inventory_locations SET active = FALSE WHERE id = ? AND business_id = ?', [location.id, id]);
  const production = await request(`/businesses/${id}/inventory/production-orders`, { headers });
  assert.equal(production.production_orders.find((row) => row.id === productionId).available_quantity, 0);
  const order = (await request(`/businesses/${id}/orders`, { method: 'POST', body: JSON.stringify({ items: [{ product_id: product.id, quantity: 1 }] }) })).order;
  const status = (value) => request(`/businesses/${id}/orders/${order.id}/update_status`, { method: 'PATCH', headers, body: JSON.stringify({ status: value }) });
  await status('confirmed');
  await status('completed');
  const directOrder = (await request(`/businesses/${id}/orders`, { method: 'POST', body: JSON.stringify({ items: [{ product_id: product.id, quantity: 1 }] }) })).order;
  await request(`/businesses/${id}/orders/${directOrder.id}/update_status`, { method: 'PATCH', headers, body: JSON.stringify({ status: 'completed' }) });
  const [lots] = await pool.query('SELECT current_quantity FROM inventory_product_lots WHERE id = ?', [lotId]);
  const [ingredients] = await pool.query('SELECT current_quantity FROM inventory_lots WHERE inventory_item_id = ?', [ingredient.id]);
  assert.equal(Number(lots[0].current_quantity), 5);
  assert.equal(Number(ingredients[0].current_quantity), 8);
  const activeProductionId = randomUUID(), activeLotId = randomUUID();
  await pool.query("INSERT INTO production_orders (id, business_id, product_id, location_id, batch_code, planned_quantity, status) VALUES (?, ?, ?, ?, ?, 1, 'completed')", [activeProductionId, id, product.id, ingredient.location_id, randomUUID()]);
  await pool.query("INSERT INTO inventory_product_lots (id, business_id, product_id, location_id, production_order_id, batch_code, produced_quantity, current_quantity) VALUES (?, ?, ?, ?, ?, ?, 1, 1)", [activeLotId, id, product.id, ingredient.location_id, activeProductionId, randomUUID()]);
  const reservedOrder = (await request(`/businesses/${id}/orders`, { method: 'POST', body: JSON.stringify({ items: [{ product_id: product.id, quantity: 1 }] }) })).order;
  await request(`/businesses/${id}/orders/${reservedOrder.id}/update_status`, { method: 'PATCH', headers, body: JSON.stringify({ status: 'confirmed' }) });
  await assert.rejects(request(`/businesses/${id}/inventory/product-lots/${activeLotId}`, { method: 'PATCH', headers, body: JSON.stringify({ status: 'quarantined' }) }), /409/);
  await request(`/businesses/${id}/inventory/product-lots/${lotId}`, { method: 'PATCH', headers, body: JSON.stringify({ status: 'quarantined' }) });
});

integrationTest("inventory adjustments protect reserved stock despite lots in inactive locations", async () => {
  const registered = await request('/auth/register', { method: 'POST', body: JSON.stringify({ email: `adjustment-${randomUUID()}@example.test`, name: 'Stock Owner', password: 'SecurePassword123' }) });
  const id = registered.business.id, headers = { Authorization: `Bearer ${registered.token}` };
  const category = (await request(`/businesses/${id}/categories`, { method: 'POST', headers, body: JSON.stringify({ name: 'Category' }) })).category;
  const product = (await request(`/businesses/${id}/products`, { method: 'POST', headers, body: JSON.stringify({ name: 'Product', price: 10, category_id: category.id }) })).product;
  const item = (await request(`/businesses/${id}/inventory/items`, { method: 'POST', headers, body: JSON.stringify({ name: 'Ingredient', unit: 'unit', current_quantity: 5 }) })).item;
  const location = (await request(`/businesses/${id}/inventory/locations`, { method: 'POST', headers, body: JSON.stringify({ name: 'Inactive', code: 'INACTIVE' }) })).location;
  const purchase = (await request(`/businesses/${id}/inventory/purchase-orders`, { method: 'POST', headers, body: JSON.stringify({ location_id: location.id, items: [{ inventory_item_id: item.id, quantity: 2, unit_cost: 1 }] }) })).purchase_order;
  const purchaseList = await request(`/businesses/${id}/inventory/purchase-orders`, { headers });
  const line = purchaseList.purchase_orders.find((row) => row.id === purchase.id).items[0];
  const receipt = (await request(`/businesses/${id}/inventory/purchase-orders/${purchase.id}/receipts`, { method: 'POST', headers: { ...headers, 'Idempotency-Key': randomUUID() }, body: JSON.stringify({ items: [{ order_item_id: line.id, quantity: 2 }] }) })).receipt;
  await pool.query("INSERT INTO inventory_lots (id, business_id, inventory_item_id, location_id, lot_code, initial_quantity, current_quantity) VALUES (?, ?, ?, ?, ?, 10, 10)", [randomUUID(), id, item.id, location.id, randomUUID()]);
  await pool.query('UPDATE inventory_locations SET active = FALSE WHERE id = ?', [location.id]);
  await request(`/businesses/${id}/inventory/purchase-receipts/${receipt.id}`, { method: 'PATCH', headers, body: JSON.stringify({ status: 'reversed' }) });
  const [afterReverse] = await pool.query('SELECT current_quantity FROM inventory_items WHERE id = ?', [item.id]);
  assert.equal(Number(afterReverse[0].current_quantity), 5);
  await request(`/businesses/${id}/products/${product.id}/recipe`, { method: 'PUT', headers, body: JSON.stringify({ ingredients: [{ inventory_item_id: item.id, quantity: 4 }] }) });
  const order = (await request(`/businesses/${id}/orders`, { method: 'POST', body: JSON.stringify({ items: [{ product_id: product.id, quantity: 1 }] }) })).order;
  await request(`/businesses/${id}/orders/${order.id}/update_status`, { method: 'PATCH', headers, body: JSON.stringify({ status: 'confirmed' }) });
  const move = (type, quantity) => request(`/businesses/${id}/inventory/items/${item.id}/movements`, { method: 'POST', headers, body: JSON.stringify({ type, quantity, location_id: item.location_id }) });
  await assert.rejects(move('loss', 2), /409/);
  await move('adjustment', 1);
  const [lots] = await pool.query("SELECT id, location_id FROM inventory_lots WHERE inventory_item_id = ? AND status = 'active'", [item.id]);
  const activeLot = lots.find((lot) => lot.location_id === item.location_id);
  const inactiveLot = lots.find((lot) => lot.location_id === location.id);
  const changeLot = (lotId, status) => request(`/businesses/${id}/inventory/lots/${lotId}`, { method: 'PATCH', headers, body: JSON.stringify({ status }) });
  await assert.rejects(changeLot(activeLot.id, 'quarantined'), /409/);
  await changeLot(inactiveLot.id, 'quarantined');
  await changeLot(inactiveLot.id, 'active');
  const [rows] = await pool.query('SELECT current_quantity FROM inventory_items WHERE id = ?', [item.id]);
  assert.equal(Number(rows[0].current_quantity), 6);
});

integrationTest("in-transit transfer waits for its destination to be active", async () => {
  const registered = await request('/auth/register', { method: 'POST', body: JSON.stringify({ email: `transfer-${randomUUID()}@example.test`, name: 'Stock Owner', password: 'SecurePassword123' }) });
  const id = registered.business.id, headers = { Authorization: `Bearer ${registered.token}` };
  const item = (await request(`/businesses/${id}/inventory/items`, { method: 'POST', headers, body: JSON.stringify({ name: 'Ingredient', unit: 'unit', current_quantity: 5 }) })).item;
  const destination = (await request(`/businesses/${id}/inventory/locations`, { method: 'POST', headers, body: JSON.stringify({ name: 'Destination', code: 'DEST' }) })).location;
  const transfer = (await request(`/businesses/${id}/inventory/transfers`, { method: 'POST', headers, body: JSON.stringify({ from_location_id: item.location_id, to_location_id: destination.id, items: [{ inventory_item_id: item.id, quantity: 1 }] }) })).transfer;
  const update = (status) => request(`/businesses/${id}/inventory/transfers/${transfer.id}`, { method: 'PATCH', headers, body: JSON.stringify({ status }) });
  await update('in_transit');
  await pool.query('UPDATE inventory_locations SET active = FALSE WHERE id = ? AND business_id = ?', [destination.id, id]);
  await assert.rejects(update('received'), /409/);
  const [during] = await pool.query('SELECT status FROM inventory_transfer_orders WHERE id = ?', [transfer.id]);
  assert.equal(during[0].status, 'in_transit');
  await pool.query('UPDATE inventory_locations SET active = TRUE WHERE id = ? AND business_id = ?', [destination.id, id]);
  await update('received');
  const [lots] = await pool.query('SELECT current_quantity FROM inventory_lots WHERE inventory_item_id = ? AND location_id = ?', [item.id, destination.id]);
  assert.equal(Number(lots[0].current_quantity), 1);
});

integrationTest("purchase reversal cannot use inactive stock to satisfy reservations", async () => {
  const registered = await request('/auth/register', { method: 'POST', body: JSON.stringify({ email: `reverse-${randomUUID()}@example.test`, name: 'Stock Owner', password: 'SecurePassword123' }) });
  const id = registered.business.id, headers = { Authorization: `Bearer ${registered.token}` };
  const category = (await request(`/businesses/${id}/categories`, { method: 'POST', headers, body: JSON.stringify({ name: 'Category' }) })).category;
  const product = (await request(`/businesses/${id}/products`, { method: 'POST', headers, body: JSON.stringify({ name: 'Product', price: 10, category_id: category.id }) })).product;
  const item = (await request(`/businesses/${id}/inventory/items`, { method: 'POST', headers, body: JSON.stringify({ name: 'Ingredient', unit: 'unit', current_quantity: 5 }) })).item;
  const inactive = (await request(`/businesses/${id}/inventory/locations`, { method: 'POST', headers, body: JSON.stringify({ name: 'Inactive', code: 'INACTIVE' }) })).location;
  await pool.query("INSERT INTO inventory_lots (id, business_id, inventory_item_id, location_id, lot_code, initial_quantity, current_quantity) VALUES (?, ?, ?, ?, ?, 10, 10)", [randomUUID(), id, item.id, inactive.id, randomUUID()]);
  await pool.query('UPDATE inventory_locations SET active = FALSE WHERE id = ?', [inactive.id]);
  const purchase = (await request(`/businesses/${id}/inventory/purchase-orders`, { method: 'POST', headers, body: JSON.stringify({ location_id: item.location_id, items: [{ inventory_item_id: item.id, quantity: 2, unit_cost: 1 }] }) })).purchase_order;
  const line = (await request(`/businesses/${id}/inventory/purchase-orders`, { headers })).purchase_orders.find((row) => row.id === purchase.id).items[0];
  const receipt = (await request(`/businesses/${id}/inventory/purchase-orders/${purchase.id}/receipts`, { method: 'POST', headers: { ...headers, 'Idempotency-Key': randomUUID() }, body: JSON.stringify({ items: [{ order_item_id: line.id, quantity: 2 }] }) })).receipt;
  await request(`/businesses/${id}/products/${product.id}/recipe`, { method: 'PUT', headers, body: JSON.stringify({ ingredients: [{ inventory_item_id: item.id, quantity: 6 }] }) });
  const order = (await request(`/businesses/${id}/orders`, { method: 'POST', body: JSON.stringify({ items: [{ product_id: product.id, quantity: 1 }] }) })).order;
  await request(`/businesses/${id}/orders/${order.id}/update_status`, { method: 'PATCH', headers, body: JSON.stringify({ status: 'confirmed' }) });
  const reverse = () => request(`/businesses/${id}/inventory/purchase-receipts/${receipt.id}`, { method: 'PATCH', headers, body: JSON.stringify({ status: 'reversed' }) });
  await assert.rejects(reverse(), /409/);
  await request(`/businesses/${id}/orders/${order.id}/update_status`, { method: 'PATCH', headers, body: JSON.stringify({ status: 'cancelled' }) });
  await reverse();
  const [rows] = await pool.query('SELECT current_quantity FROM inventory_items WHERE id = ?', [item.id]);
  assert.equal(Number(rows[0].current_quantity), 5);
});

integrationTest("local administrator can open, use, and close a cash register without a synthetic user", async () => {
  const headers = { "X-Food-System-Local": "true" };
  const business = (await request("/local/business", { method: "PUT", headers, body: JSON.stringify({ name: "Local cash test" }) })).business;
  const opened = await request(`/businesses/${business.id}/cash-register/open`, { method: "POST", headers, body: JSON.stringify({ opening_amount: 20 }) });
  await request(`/businesses/${business.id}/cash_movements`, { method: "POST", headers, body: JSON.stringify({ type: "entry", amount: 5 }) });
  const closed = await request(`/businesses/${business.id}/cash-register/${opened.session.id}/close`, { method: "POST", headers, body: JSON.stringify({ closing_amount: 25 }) });
  assert.equal(closed.reconciliation.expected_amount, 25);
  assert.equal(closed.reconciliation.difference_amount, 0);
  const [sessions] = await pool.query("SELECT opened_by, closed_by, status FROM cash_register_sessions WHERE id = ?", [opened.session.id]);
  assert.equal(sessions[0].status, "closed");
  assert.equal(sessions[0].opened_by, null);
  assert.equal(sessions[0].closed_by, null);
});

integrationTest("API rejects anonymous business creation and assigns the authenticated owner", async () => {
  await assert.rejects(request("/businesses", { method: "POST", body: JSON.stringify({ name: "Anonymous business" }) }), /401/);
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const registered = await request("/auth/register", { method: "POST", body: JSON.stringify({ email: `business-${suffix}@example.test`, name: "Business Owner", password: "SecurePassword123" }) });
  const auth = { Authorization: `Bearer ${registered.token}` };
  const invalidBusinesses = [
    { name: 12 },
    { name: "x" },
    { name: "B".repeat(161) },
    { name: "Valid Name", description: "😀".repeat(16_384) },
    { name: "Valid Name", primary_color: "url(javascript:alert(1))" },
  ];
  for (const business of invalidBusinesses) {
    await assert.rejects(request("/businesses", { method: "POST", headers: auth, body: JSON.stringify(business) }), /400/);
  }
  const created = await request("/businesses", { method: "POST", headers: { Authorization: `Bearer ${registered.token}` }, body: JSON.stringify({ name: `Second business ${suffix}` }) });
  assert.equal(created.business.name, `Second business ${suffix}`);
  const team = await request(`/businesses/${created.business.id}/team`, { headers: { Authorization: `Bearer ${registered.token}` } });
  assert.equal(team.members[0].role, "owner");
});

integrationTest("managers can remove staff but cannot remove peer managers", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const owner = await request("/auth/register", { method: "POST", body: JSON.stringify({ email: `team-owner-${suffix}@example.test`, name: "Team Owner", password: "SecurePassword123" }) });
  const manager = await request("/auth/register", { method: "POST", body: JSON.stringify({ email: `team-manager-${suffix}@example.test`, name: "Team Manager", password: "SecurePassword123" }) });
  const staff = await request("/auth/register", { method: "POST", body: JSON.stringify({ email: `team-staff-${suffix}@example.test`, name: "Team Staff", password: "SecurePassword123" }) });
  const ownerAuth = { Authorization: `Bearer ${owner.token}` };
  const managerAuth = { Authorization: `Bearer ${manager.token}` };
  const managerMember = await request(`/businesses/${owner.business.id}/team`, {
    method: "POST", headers: ownerAuth,
    body: JSON.stringify({ email: manager.user.email, name: manager.user.name, role: "manager" }),
  });
  const staffMember = await request(`/businesses/${owner.business.id}/team`, {
    method: "POST", headers: ownerAuth,
    body: JSON.stringify({ email: staff.user.email, name: staff.user.name, role: "staff" }),
  });

  const peerRemoval = await fetch(`${base}/businesses/${owner.business.id}/team/${managerMember.member.id}`, { method: "DELETE", headers: managerAuth });
  assert.equal(peerRemoval.status, 403);
  const staffRemoval = await fetch(`${base}/businesses/${owner.business.id}/team/${staffMember.member.id}`, { method: "DELETE", headers: managerAuth });
  assert.equal(staffRemoval.status, 204);
});

integrationTest("team invitations reject unsupported roles and values beyond identity column limits", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const owner = await request("/auth/register", { method: "POST", body: JSON.stringify({ email: `team-validation-${suffix}@example.test`, name: "Team Validation Owner", password: "SecurePassword123" }) });
  const path = `/businesses/${owner.business.id}/team`;
  const invalidInvitations = [
    { name: "Valid Name", email: `valid-${suffix}@example.test`, role: "administrator" },
    { name: "N".repeat(161), email: `long-name-${suffix}@example.test`, role: "staff" },
    { name: "Valid Name", email: `${"a".repeat(180)}@example.test`, role: "staff" },
  ];
  for (const membership of invalidInvitations) {
    const response = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${owner.token}` },
      body: JSON.stringify({ membership }),
    });
    assert.equal(response.status, 400);
  }
});

integrationTest("API allows only one concurrent cash register opening per business", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const registered = await request("/auth/register", { method: "POST", body: JSON.stringify({ email: `cash-lock-${suffix}@example.test`, name: "Cash Lock Owner", password: "SecurePassword123" }) });
  const auth = { Authorization: `Bearer ${registered.token}` };
  const path = `/businesses/${registered.business.id}/cash-register/open`;
  const attempts = await Promise.allSettled([
    request(path, { method: "POST", headers: auth, body: JSON.stringify({ opening_amount: 0 }) }),
    request(path, { method: "POST", headers: auth, body: JSON.stringify({ opening_amount: 0 }) }),
  ]);
  assert.equal(attempts.filter((attempt) => attempt.status === "fulfilled").length, 1);
  assert.equal(attempts.filter((attempt) => attempt.status === "rejected" && /409/.test(attempt.reason.message)).length, 1);
});

integrationTest("API rejects orders beyond supported item and decimal limits", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const registered = await request("/auth/register", { method: "POST", body: JSON.stringify({ email: `order-limit-${suffix}@example.test`, name: "Order Limit Owner", password: "SecurePassword123" }) });
  const businessId = registered.business.id;
  const auth = { Authorization: `Bearer ${registered.token}` };
  const category = await request(`/businesses/${businessId}/categories`, { method: "POST", headers: auth, body: JSON.stringify({ name: `Limit ${suffix}` }) });
  const product = await request(`/businesses/${businessId}/products`, { method: "POST", headers: auth, body: JSON.stringify({ name: `Expensive ${suffix}`, price: 99999999.99, category_id: category.category.id }) });
  const oversized = [
    { items: [{ product_id: product.product.id, quantity: 999 }] },
    { items: Array.from({ length: 101 }, () => ({ product_id: product.product.id, quantity: 1 })) },
    { items: [{ product_id: { malformed: true }, quantity: 1 }] },
    { items: [{ product_id: product.product.id, quantity: 1 }], table_token: [] },
  ];
  for (const body of oversized) {
    const response = await fetch(`${base}/businesses/${businessId}/orders`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, idempotency_key: randomUUID() }) });
    assert.equal(response.status, 400);
  }
  const orders = await request(`/businesses/${businessId}/orders`, { headers: auth });
  assert.equal(orders.orders.length, 0);
});

integrationTest("API validates and persists split order payments", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const registered = await request("/auth/register", { method: "POST", body: JSON.stringify({ email: `split-${suffix}@example.test`, name: "Split Owner", password: "SecurePassword123" }) });
  const auth = { Authorization: `Bearer ${registered.token}` };
  const businessId = registered.business.id;
  const category = await request(`/businesses/${businessId}/categories`, { method: "POST", headers: auth, body: JSON.stringify({ name: `Split ${suffix}` }) });
  const product = await request(`/businesses/${businessId}/products`, { method: "POST", headers: auth, body: JSON.stringify({ name: `Produto ${suffix}`, price: 20, category_id: category.category.id }) });
  const pix = await request(`/businesses/${businessId}/payment-methods`, { method: "POST", headers: auth, body: JSON.stringify({ name: `Pix ${suffix}` }) });
  const card = await request(`/businesses/${businessId}/payment-methods`, { method: "POST", headers: auth, body: JSON.stringify({ name: `Card ${suffix}` }) });
  for (const body of [
    { items: [{ product_id: product.product.id, quantity: 1.005 }] },
    { items: [{ product_id: product.product.id, quantity: 1 }], payments: [{ payment_method_id: pix.method.id, amount: 20.005 }] },
  ]) await assert.rejects(request(`/businesses/${businessId}/orders`, { method: "POST", body: JSON.stringify(body) }), /400/);
  await assert.rejects(request(`/businesses/${businessId}/products`, { method: "POST", headers: auth, body: JSON.stringify({ name: `Fractional price ${suffix}`, price: 1.005, category_id: category.category.id }) }), /400/);
  await assert.rejects(request(`/businesses/${businessId}/cash-register/open`, { method: "POST", headers: auth, body: JSON.stringify({ opening_amount: 10.005 }) }), /400/);
  const order = await request(`/businesses/${businessId}/orders`, { method: "POST", body: JSON.stringify({ items: [{ product_id: product.product.id, quantity: 2 }], payments: [{ payment_method_id: pix.method.id, amount: 15 }, { payment_method_id: card.method.id, amount: 25 }] }) });
  const orders = await request(`/businesses/${businessId}/orders`, { headers: auth });
  const saved = orders.orders.find((row) => row.id === order.order.id);
  assert.equal(saved.payments.length, 2);
  assert.equal(saved.payments.reduce((sum, payment) => sum + Number(payment.amount), 0), 40);
});

integrationTest("API assigns and advances a local delivery", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const registered = await request("/auth/register", { method: "POST", body: JSON.stringify({ email: `courier-${suffix}@example.test`, name: "Courier Owner", password: "SecurePassword123" }) });
  const auth = { Authorization: `Bearer ${registered.token}` };
  const businessId = registered.business.id;
  const courier = await request(`/businesses/${businessId}/couriers`, { method: "POST", headers: auth, body: JSON.stringify({ name: "Alex Driver", phone: "71999999999" }) });
  const category = await request(`/businesses/${businessId}/categories`, { method: "POST", headers: auth, body: JSON.stringify({ name: `Courier ${suffix}` }) });
  const product = await request(`/businesses/${businessId}/products`, { method: "POST", headers: auth, body: JSON.stringify({ name: `Delivery ${suffix}`, price: 18, category_id: category.category.id }) });
  const order = await request(`/businesses/${businessId}/orders`, { method: "POST", body: JSON.stringify({ items: [{ product_id: product.product.id, quantity: 1 }], delivery: { address: { street: "Rua A", number: "1", city: "Salvador" }, fee: 2 } }) });
  const waiting = await request(`/businesses/${businessId}/deliveries`, { headers: auth });
  assert.equal(waiting.deliveries.length, 1);
  assert.equal(waiting.deliveries[0].order_id, order.order.id);
  assert.equal(waiting.deliveries[0].status, "requested");
  const deliveryPath = `/businesses/${businessId}/orders/${order.order.id}/delivery`;
  const assignments = await Promise.allSettled([
    request(deliveryPath, { method: "POST", headers: auth, body: JSON.stringify({ courier_id: courier.courier.id }) }),
    request(deliveryPath, { method: "POST", headers: auth, body: JSON.stringify({ courier_id: courier.courier.id }) }),
  ]);
  assert.equal(assignments.filter((attempt) => attempt.status === "fulfilled").length, 1);
  assert.equal(assignments.filter((attempt) => attempt.status === "rejected" && /409/.test(attempt.reason.message)).length, 1);
  const assigned = assignments.find((attempt) => attempt.status === "fulfilled").value;
  assert.equal(assigned.delivery.status, "assigned");
  assert.equal(assigned.delivery.id, waiting.deliveries[0].id);
  const kitchenAfterAssignment = await request(`/businesses/${businessId}/orders?view=kitchen`, { headers: auth });
  assert.equal(kitchenAfterAssignment.orders.find((row) => row.id === order.order.id)?.status, "pending");
  const courierToken = await request(`/businesses/${businessId}/couriers/${courier.courier.id}/token`, { method: "POST", headers: auth, body: JSON.stringify({}) });
  const courierDeliveries = await fetch(`${base}/courier/deliveries`, { headers: { "X-Courier-Token": courierToken.token } });
  assert.equal(courierDeliveries.status, 200);
  const courierPayload = await courierDeliveries.json();
  assert.equal(courierPayload.deliveries[0].id, assigned.delivery.id);
  const courierRegression = await fetch(`${base}/courier/deliveries/${assigned.delivery.id}`, { method: "PATCH", headers: { "Content-Type": "application/json", "X-Courier-Token": courierToken.token }, body: JSON.stringify({ status: "assigned" }) });
  assert.equal(courierRegression.status, 400);
  const locationResponse = await fetch(`${base}/courier/location`, { method: "POST", headers: { "Content-Type": "application/json", "X-Courier-Token": courierToken.token }, body: JSON.stringify({ latitude: -12.9714, longitude: -38.5014, accuracy_m: 12 }) });
  assert.equal(locationResponse.status, 200);
  const duplicateLocationResponse = await fetch(`${base}/courier/location`, { method: "POST", headers: { "Content-Type": "application/json", "X-Courier-Token": courierToken.token }, body: JSON.stringify({ latitude: -12.9715, longitude: -38.5015 }) });
  assert.equal(duplicateLocationResponse.status, 429);
  const [savedLocationCount] = await pool.query("SELECT COUNT(*) AS count FROM courier_locations WHERE courier_id = ?", [courier.courier.id]);
  assert.equal(Number(savedLocationCount[0].count), 1);
  const locations = await request(`/businesses/${businessId}/couriers/locations`, { headers: auth });
  assert.equal(Number(locations.locations.find((row) => row.courier_id === courier.courier.id).latitude), -12.9714);
  const advancedCourier = await fetch(`${base}/courier/deliveries/${assigned.delivery.id}`, { method: "PATCH", headers: { "Content-Type": "application/json", "X-Courier-Token": courierToken.token }, body: JSON.stringify({ status: "picked_up" }) });
  assert.equal(advancedCourier.status, 200);
  const [pickedOrder] = await pool.query("SELECT status FROM orders WHERE id = ?", [order.order.id]);
  assert.equal(pickedOrder[0].status, "out_for_delivery");
  const completedCourier = await fetch(`${base}/courier/deliveries/${assigned.delivery.id}`, { method: "PATCH", headers: { "Content-Type": "application/json", "X-Courier-Token": courierToken.token }, body: JSON.stringify({ status: "delivered" }) });
  assert.equal(completedCourier.status, 200);
  const activeAfterDelivery = await request(`/businesses/${businessId}/orders?view=active`, { headers: auth });
  assert.equal(activeAfterDelivery.orders.find((entry) => entry.id === order.order.id)?.status, "out_for_delivery");
  const kitchenAfterPickup = await request(`/businesses/${businessId}/orders?view=kitchen`, { headers: auth });
  assert.equal(kitchenAfterPickup.orders.some((entry) => entry.id === order.order.id), false);
  await request(`/businesses/${businessId}/orders/${order.order.id}/update_status`, { method: "PATCH", headers: auth, body: JSON.stringify({ status: "completed" }) });
  const activeAfterCompletion = await request(`/businesses/${businessId}/orders?view=active`, { headers: auth });
  assert.equal(activeAfterCompletion.orders.some((entry) => entry.id === order.order.id), false);
  const locationAfterDelivery = await fetch(`${base}/courier/location`, { method: "POST", headers: { "Content-Type": "application/json", "X-Courier-Token": courierToken.token }, body: JSON.stringify({ latitude: -12.9716, longitude: -38.5016 }) });
  assert.equal(locationAfterDelivery.status, 409);
  const locationsAfterDelivery = await request(`/businesses/${businessId}/couriers/locations`, { headers: auth });
  assert.equal(locationsAfterDelivery.locations.find((row) => row.courier_id === courier.courier.id).latitude, null);
  const listed = await request(`/businesses/${businessId}/deliveries`, { headers: auth });
  assert.equal(listed.deliveries[0].courier_name, "Alex Driver");
  const secondOrder = (await request(`/businesses/${businessId}/orders`, { method: "POST", body: JSON.stringify({ items: [{ product_id: product.product.id, quantity: 1 }], delivery: { address: { street: "Rua B", number: "2", city: "Salvador" } } }) })).order;
  const secondDelivery = (await request(`/businesses/${businessId}/orders/${secondOrder.id}/delivery`, { method: "POST", headers: auth, body: JSON.stringify({ courier_id: courier.courier.id }) })).delivery;
  await request(`/businesses/${businessId}/deliveries/${secondDelivery.id}`, { method: "PATCH", headers: auth, body: JSON.stringify({ status: "picked_up" }) });
  const [adminPickedOrder] = await pool.query("SELECT status FROM orders WHERE id = ?", [secondOrder.id]);
  assert.equal(adminPickedOrder[0].status, "out_for_delivery");
});

integrationTest("delivery assignment reserves stock and order cancellation closes courier work", async () => {
  const registered = await request("/auth/register", { method: "POST", body: JSON.stringify({ email: `delivery-stock-${randomUUID()}@example.test`, name: "Delivery Owner", password: "SecurePassword123" }) });
  const auth = { Authorization: `Bearer ${registered.token}` };
  const id = registered.business.id;
  const courier = (await request(`/businesses/${id}/couriers`, { method: "POST", headers: auth, body: JSON.stringify({ name: "Courier" }) })).courier;
  const category = (await request(`/businesses/${id}/categories`, { method: "POST", headers: auth, body: JSON.stringify({ name: "Meals" }) })).category;
  const product = (await request(`/businesses/${id}/products`, { method: "POST", headers: auth, body: JSON.stringify({ name: "Meal", price: 10, category_id: category.id }) })).product;
  const item = (await request(`/businesses/${id}/inventory/items`, { method: "POST", headers: auth, body: JSON.stringify({ name: "Ingredient", unit: "unit", current_quantity: 1 }) })).item;
  await request(`/businesses/${id}/products/${product.id}/recipe`, { method: "PUT", headers: auth, body: JSON.stringify({ ingredients: [{ inventory_item_id: item.id, quantity: 2 }] }) });
  const order = (await request(`/businesses/${id}/orders`, { method: "POST", body: JSON.stringify({ items: [{ product_id: product.id, quantity: 1 }], delivery: { address: { street: "Rua A", number: "1", city: "Salvador" } } }) })).order;
  const assignmentPath = `/businesses/${id}/orders/${order.id}/delivery`;
  const assign = () => request(assignmentPath, { method: "POST", headers: auth, body: JSON.stringify({ courier_id: courier.id }) });
  await assert.rejects(assign(), /409/);
  const [afterFailure] = await pool.query("SELECT status FROM orders WHERE id = ?", [order.id]);
  assert.equal(afterFailure[0].status, "pending");
  await request(`/businesses/${id}/inventory/items/${item.id}/movements`, { method: "POST", headers: auth, body: JSON.stringify({ type: "adjustment", quantity: 1 }) });
  const assignment = (await assign()).delivery;
  const [reservations] = await pool.query("SELECT status FROM inventory_reservations WHERE order_id = ?", [order.id]);
  assert.equal(reservations[0].status, "held");
  const token = (await request(`/businesses/${id}/couriers/${courier.id}/token`, { method: "POST", headers: auth, body: "{}" })).token;
  const location = await fetch(`${base}/courier/location`, { method: "POST", headers: { "Content-Type": "application/json", "X-Courier-Token": token }, body: JSON.stringify({ latitude: -12, longitude: -38 }) });
  assert.equal(location.status, 200);
  await request(`/businesses/${id}/orders/${order.id}/update_status`, { method: "PATCH", headers: auth, body: JSON.stringify({ status: "cancelled" }) });
  const [delivery] = await pool.query("SELECT status FROM delivery_assignments WHERE id = ?", [assignment.id]);
  const [released] = await pool.query("SELECT status FROM inventory_reservations WHERE order_id = ?", [order.id]);
  const [locations] = await pool.query("SELECT id FROM courier_locations WHERE courier_id = ?", [courier.id]);
  assert.equal(delivery[0].status, "cancelled");
  assert.equal(released[0].status, "released");
  assert.equal(locations.length, 0);
  const update = await fetch(`${base}/courier/deliveries/${assignment.id}`, { method: "PATCH", headers: { "Content-Type": "application/json", "X-Courier-Token": token }, body: JSON.stringify({ status: "picked_up" }) });
  assert.equal(update.status, 409);
});

integrationTest("API creates a scheduled delivery with validated address and fee", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const registered = await request("/auth/register", { method: "POST", body: JSON.stringify({ email: `delivery-${suffix}@example.test`, name: "Delivery Owner", password: "SecurePassword123" }) });
  const auth = { Authorization: `Bearer ${registered.token}` };
  const businessId = registered.business.id;
  await assert.rejects(request(`/businesses/${businessId}`, { method: "PATCH", headers: auth, body: JSON.stringify({ settings: { delivery_fee: 1.005 } }) }), /400/);
  await request(`/businesses/${businessId}`, { method: "PATCH", headers: auth, body: JSON.stringify({ settings: { delivery_fee: 5 } }) });
  const category = await request(`/businesses/${businessId}/categories`, { method: "POST", headers: auth, body: JSON.stringify({ name: `Delivery ${suffix}` }) });
  const product = await request(`/businesses/${businessId}/products`, { method: "POST", headers: auth, body: JSON.stringify({ name: `Lanche ${suffix}`, price: 20, category_id: category.category.id }) });
  const idempotencyKey = "123e4567-e89b-42d3-a456-426614174000";
  const orderRequest = { idempotency_key: idempotencyKey, order: { customer_name: "Maria Silva" }, items: [{ product_id: product.product.id, quantity: 1 }], delivery: { address: { street: "Rua Central", number: "10", city: "Salvador" }, fee: 0, scheduled_for: "2030-01-01T12:00:00.000Z" } };
  const requestWithoutKey = { ...orderRequest };
  delete requestWithoutKey.idempotency_key;
  const missingKeyResponse = await fetch(`${base}/businesses/${businessId}/orders`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestWithoutKey) });
  assert.equal(missingKeyResponse.status, 400);
  const firstResponse = await fetch(`${base}/businesses/${businessId}/orders`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(orderRequest) });
  assert.equal(firstResponse.status, 201);
  const delivery = await firstResponse.json();
  await request(`/businesses/${businessId}/products/${product.product.id}`, { method: "PATCH", headers: auth, body: JSON.stringify({ active: false, price: 30 }) });
  await request(`/businesses/${businessId}`, { method: "PATCH", headers: auth, body: JSON.stringify({ settings: { delivery_fee: 9 } }) });
  const retryResponse = await fetch(`${base}/businesses/${businessId}/orders`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(orderRequest) });
  assert.equal(retryResponse.status, 200);
  const retry = await retryResponse.json();
  assert.equal(retry.order.id, delivery.order.id);
  assert.equal(retry.order.total, 25);
  const deliveryList = await request(`/businesses/${businessId}/deliveries`, { headers: auth });
  assert.equal(deliveryList.deliveries.filter((entry) => entry.order_id === delivery.order.id).length, 1);
  const mismatchedRetry = await fetch(`${base}/businesses/${businessId}/orders`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...orderRequest, order: { customer_name: "Another customer" } }) });
  assert.equal(mismatchedRetry.status, 409);
  assert.equal(delivery.order.total, 25);
  assert.equal(delivery.order.delivery_address.city, "Salvador");
  assert.equal(Number(delivery.order.delivery_fee), 5);
  assert.equal(delivery.order.customer_name, "Maria Silva");
  const listed = await request(`/businesses/${businessId}/orders`, { headers: auth });
  assert.equal(listed.orders.find((row) => row.id === delivery.order.id).customer_name, "Maria Silva");
});

integrationTest("API rejects cross-business administrative access", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const first = await request("/auth/register", {
    method: "POST", body: JSON.stringify({ email: `first-${suffix}@example.test`, name: "First Owner", password: "SecurePassword123" }),
  });
  const second = await request("/auth/register", {
    method: "POST", body: JSON.stringify({ email: `second-${suffix}@example.test`, name: "Second Owner", password: "SecurePassword123" }),
  });
  await assert.rejects(
    request(`/businesses/${second.business.id}/categories`, { headers: { Authorization: `Bearer ${first.token}` } }),
    /403/,
  );
});

integrationTest("API prevents products from referencing another business category or kitchen station", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const first = await request("/auth/register", { method: "POST", body: JSON.stringify({ email: `catalog-a-${suffix}@example.test`, name: "Catalog A", password: "SecurePassword123" }) });
  const second = await request("/auth/register", { method: "POST", body: JSON.stringify({ email: `catalog-b-${suffix}@example.test`, name: "Catalog B", password: "SecurePassword123" }) });
  const firstAuth = { Authorization: `Bearer ${first.token}` };
  const secondAuth = { Authorization: `Bearer ${second.token}` };
  const firstBusiness = first.business.id;
  const secondBusiness = second.business.id;
  const firstCategory = await request(`/businesses/${firstBusiness}/categories`, { method: "POST", headers: firstAuth, body: JSON.stringify({ name: `Own ${suffix}` }) });
  const secondCategory = await request(`/businesses/${secondBusiness}/categories`, { method: "POST", headers: secondAuth, body: JSON.stringify({ name: `Foreign ${suffix}` }) });
  const secondStation = await request(`/businesses/${secondBusiness}/kitchen-stations`, { method: "POST", headers: secondAuth, body: JSON.stringify({ name: `Foreign station ${suffix}` }) });
  const product = await request(`/businesses/${firstBusiness}/products`, { method: "POST", headers: firstAuth, body: JSON.stringify({ name: `Own product ${suffix}`, price: 1, category_id: firstCategory.category.id, image: "data:image/jpeg;base64,AA==" }) });

  for (const [path, options] of [
    [`/businesses/${firstBusiness}/products`, { method: "POST", headers: firstAuth, body: JSON.stringify({ name: `Invalid product ${suffix}`, price: 1, category_id: secondCategory.category.id }) }],
    [`/businesses/${firstBusiness}/products/${product.product.id}`, { method: "PATCH", headers: firstAuth, body: JSON.stringify({ category_id: secondCategory.category.id }) }],
    [`/businesses/${firstBusiness}/products/${product.product.id}`, { method: "PATCH", headers: firstAuth, body: JSON.stringify({ kitchen_station_id: secondStation.station.id }) }],
    [`/businesses/${firstBusiness}/products/${product.product.id}`, { method: "PATCH", headers: firstAuth, body: JSON.stringify({ price: -1 }) }],
  ]) {
    const response = await fetch(`${base}${path}`, { ...options, headers: { "Content-Type": "application/json", ...options.headers } });
    assert.equal(response.status, 400);
  }
  const unchangedCategory = await request(`/businesses/${firstBusiness}/categories/${firstCategory.category.id}`, { method: "PATCH", headers: firstAuth, body: JSON.stringify({ name: firstCategory.category.name }) });
  assert.equal(unchangedCategory.category.id, firstCategory.category.id);
  const unchangedProduct = await request(`/businesses/${firstBusiness}/products/${product.product.id}`, { method: "PATCH", headers: firstAuth, body: JSON.stringify({ name: product.product.name }) });
  assert.equal(unchangedProduct.product.id, product.product.id);
  const clearedImage = await request(`/businesses/${firstBusiness}/products/${product.product.id}`, { method: "PATCH", headers: firstAuth, body: JSON.stringify({ image_url: null }) });
  assert.equal(clearedImage.product.image_url, null);
});

integrationTest("API ingests an external order idempotently", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const registered = await request("/auth/register", {
    method: "POST", body: JSON.stringify({ email: `external-${suffix}@example.test`, name: "External Owner", password: "SecurePassword123" }),
  });
  const auth = { Authorization: `Bearer ${registered.token}` };
  const businessId = registered.business.id;
  const connection = await request(`/businesses/${businessId}/integrations`, {
    method: "POST", headers: auth, body: JSON.stringify({ provider: "99food", display_name: "99Food principal" }),
  });
  const oversizedSettings = await fetch(`${base}/businesses/${businessId}/integrations/${connection.connection.id}`, {
    method: "PATCH", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ settings: { test_url: "https://example.test", extra: "x".repeat(32 * 1024) } }),
  });
  assert.equal(oversizedSettings.status, 400);
  const webhookSecret = `webhook-${suffix}-secret`;
  await request(`/businesses/${businessId}/integrations/${connection.connection.id}/credentials`, {
    method: "POST", headers: auth, body: JSON.stringify({ credentials: { webhook_secret: webhookSecret } }),
  });
  const oversizedCredentials = await fetch(`${base}/businesses/${businessId}/integrations/${connection.connection.id}/credentials`, {
    method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ credentials: { api_token: "x".repeat(32 * 1024 + 1) } }),
  });
  assert.equal(oversizedCredentials.status, 400);
  const shortWebhookSecret = await fetch(`${base}/businesses/${businessId}/integrations/${connection.connection.id}/credentials`, {
    method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ credentials: { webhook_secret: "short" } }),
  });
  assert.equal(shortWebhookSecret.status, 400);
  for (const invalidSecret of [null, 32, [], {}]) {
    const invalidWebhookSecret = await fetch(`${base}/businesses/${businessId}/integrations/${connection.connection.id}/credentials`, {
      method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ credentials: { webhook_secret: invalidSecret } }),
    });
    assert.equal(invalidWebhookSecret.status, 400);
  }
  const event = { event_type: "order.received", external_order_id: `99food-${suffix}`, payload: { total: 42.5, items: [] } };
  const eventBody = JSON.stringify(event);
  const signature = `sha256=${createHmac("sha256", webhookSecret).update(eventBody).digest("hex")}`;
  const firstResponse = await fetch(`${base}/businesses/${businessId}/integrations/${connection.connection.id}/events`, { method: "POST", headers: { "Content-Type": "application/json", "X-Integration-Signature": signature }, body: eventBody });
  assert.equal(firstResponse.ok, true);
  const first = await firstResponse.json();
  const second = await request(`/businesses/${businessId}/integrations/${connection.connection.id}/events`, {
    method: "POST", headers: auth, body: JSON.stringify(event),
  });
  assert.equal(first.event.status, "processed");
  assert.equal(second.external_order.id, first.external_order.id);
  assert.equal(second.event.duplicate, true);
  const [storedEvents] = await pool.query("SELECT COUNT(*) AS count FROM integration_events WHERE integration_connection_id = ? AND external_order_id = ? AND event_type = 'order.received'", [connection.connection.id, event.external_order_id]);
  assert.equal(Number(storedEvents[0].count), 1);
  const unsupportedEvent = await fetch(`${base}/businesses/${businessId}/integrations/${connection.connection.id}/events`, {
    method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ event_type: "order.updated", external_order_id: event.external_order_id }),
  });
  assert.equal(unsupportedEvent.status, 400);
  const oversizedExternalId = await fetch(`${base}/businesses/${businessId}/integrations/${connection.connection.id}/events`, {
    method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ event_type: "order.received", external_order_id: "x".repeat(191) }),
  });
  assert.equal(oversizedExternalId.status, 400);
  const oversizedEventPayload = await fetch(`${base}/businesses/${businessId}/integrations/${connection.connection.id}/events`, {
    method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ event_type: "order.received", external_order_id: `oversized-${suffix}`, payload: { data: "x".repeat(256 * 1024) } }),
  });
  assert.equal(oversizedEventPayload.status, 400);
  const oversizedEventBody = await fetch(`${base}/businesses/${businessId}/integrations/${connection.connection.id}/events`, {
    method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ event_type: "order.received", external_order_id: `oversized-body-${suffix}`, payload: { data: "x".repeat(260 * 1024) } }),
  });
  assert.equal(oversizedEventBody.status, 413);

  const category = await request(`/businesses/${businessId}/categories`, { method: "POST", headers: auth, body: JSON.stringify({ name: `Marketplace ${suffix}` }) });
  const product = await request(`/businesses/${businessId}/products`, { method: "POST", headers: auth, body: JSON.stringify({ name: `Marketplace item ${suffix}`, price: 42.5, category_id: category.category.id }) });
  const localOrder = await request(`/businesses/${businessId}/orders`, { method: "POST", body: JSON.stringify({ items: [{ product_id: product.product.id, quantity: 1 }] }) });
  const linked = await request(`/businesses/${businessId}/external-orders/${first.external_order.id}`, { method: "PATCH", headers: auth, body: JSON.stringify({ order_id: localOrder.order.id, status: "accepted" }) });
  assert.equal(linked.external_order.order_id, localOrder.order.id);
  assert.equal(linked.external_order.status, "accepted");
  const advanced = await request(`/businesses/${businessId}/external-orders/${first.external_order.id}`, { method: "PATCH", headers: auth, body: JSON.stringify({ status: "preparing" }) });
  assert.equal(advanced.external_order.order_id, localOrder.order.id);
  assert.equal(advanced.external_order.status, "preparing");
  await assert.rejects(request(`/businesses/${businessId}/external-orders/${first.external_order.id}`, { method: "PATCH", headers: auth, body: JSON.stringify({ status: "completed" }) }), /Complete linked orders through the local order workflow/);
  const localOrders = await request(`/businesses/${businessId}/orders`, { headers: auth });
  assert.equal(localOrders.orders.find((order) => order.id === localOrder.order.id).status, "preparing");

  const invalidResponse = await fetch(`${base}/businesses/${businessId}/integrations/${connection.connection.id}/events`, { method: "POST", headers: { "Content-Type": "application/json", "X-Integration-Signature": `sha256=${"0".repeat(64)}` }, body: eventBody });
  assert.equal(invalidResponse.status, 401);
  const registeredStaff = await request("/auth/register", { method: "POST", body: JSON.stringify({ email: `external-staff-${suffix}@example.test`, name: "External Staff", password: "SecurePassword123" }) });
  await request(`/businesses/${businessId}/team`, { method: "POST", headers: auth, body: JSON.stringify({ full_name: registeredStaff.user.name, email: registeredStaff.user.email, role: "staff" }) });
  const staffEvent = await fetch(`${base}/businesses/${businessId}/integrations/${connection.connection.id}/events`, {
    method: "POST",
    headers: { Authorization: `Bearer ${registeredStaff.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ event_type: "order.received", external_order_id: `staff-forged-${suffix}`, payload: {} }),
  });
  assert.equal(staffEvent.status, 403);

  const externalOrders = await request(`/businesses/${businessId}/external-orders`, { headers: auth });
  assert.equal(externalOrders.orders.length, 1);
  assert.equal(externalOrders.orders[0].provider, "99food");
});

integrationTest("API rejects oversized fiscal documents before storage", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const registered = await request("/auth/register", {
    method: "POST", body: JSON.stringify({ email: `fiscal-${suffix}@example.test`, name: "Fiscal Owner", password: "SecurePassword123" }),
  });
  const response = await fetch(`${base}/businesses/${registered.business.id}/fiscal/documents`, {
    method: "POST",
    headers: { Authorization: `Bearer ${registered.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ document_type: "nfce", payload: { data: "x".repeat(256 * 1024) } }),
  });
  assert.equal(response.status, 400);

  const auth = { Authorization: `Bearer ${registered.token}` };
  const draft = await request(`/businesses/${registered.business.id}/fiscal/documents`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ document_type: "nfce", payload: {} }),
  });
  const issue = await fetch(`${base}/businesses/${registered.business.id}/fiscal/documents/${draft.document.id}/issue`, {
    method: "POST",
    headers: auth,
  });
  assert.equal(issue.status, 503);
  assert.match((await issue.json()).error, /Fiscal issuance is disabled/);
  const stored = await request(`/businesses/${registered.business.id}/fiscal/documents`, { headers: auth });
  assert.equal(stored.documents.find((document) => document.id === draft.document.id).status, "draft");
  assert.equal(stored.configuration.issuanceAvailable, false);
});

integrationTest("API manages inventory movements and product recipes", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const registered = await request("/auth/register", {
    method: "POST", body: JSON.stringify({ email: `stock-${suffix}@example.test`, name: "Stock Owner", password: "SecurePassword123" }),
  });
  const auth = { Authorization: `Bearer ${registered.token}` };
  const businessId = registered.business.id;
  const oversizedPurchase = await fetch(`${base}/businesses/${businessId}/purchases`, {
    method: "POST", headers: { "Content-Type": "application/json", ...auth },
    body: JSON.stringify({ items: Array.from({ length: 101 }, () => ({ inventory_item_id: "unused", quantity: 1, unit_cost: 1 })) }),
  });
  assert.equal(oversizedPurchase.status, 400);
  const oversizedItem = await fetch(`${base}/businesses/${businessId}/inventory/items`, {
    method: "POST", headers: { "Content-Type": "application/json", ...auth },
    body: JSON.stringify({ name: "Oversized quantity", current_quantity: 1_000_000_000 }),
  });
  assert.equal(oversizedItem.status, 400);
  const item = await request(`/businesses/${businessId}/inventory/items`, {
    method: "POST", headers: auth, body: JSON.stringify({ name: `Meat ${suffix}`, unit: "g", current_quantity: 1000 }),
  });
  const category = await request(`/businesses/${businessId}/categories`, {
    method: "POST", headers: auth, body: JSON.stringify({ name: `Inventory ${suffix}` }),
  });
  const product = await request(`/businesses/${businessId}/products`, {
    method: "POST", headers: auth, body: JSON.stringify({ name: `Burger ${suffix}`, price: 25, category_id: category.category.id }),
  });
  const recipe = await request(`/businesses/${businessId}/products/${product.product.id}/recipe`, {
    method: "PUT", headers: auth, body: JSON.stringify({ ingredients: [{ inventory_item_id: item.item.id, quantity: 150 }] }),
  });
  assert.equal(recipe.saved, true);
  const oversizedRecipe = await fetch(`${base}/businesses/${businessId}/products/${product.product.id}/recipe`, {
    method: "PUT", headers: { "Content-Type": "application/json", ...auth },
    body: JSON.stringify({ ingredients: Array.from({ length: 101 }, () => ({ inventory_item_id: item.item.id, quantity: 1 })) }),
  });
  assert.equal(oversizedRecipe.status, 400);
  const order = await request(`/businesses/${businessId}/orders`, {
    method: "POST", body: JSON.stringify({ items: [{ product_id: product.product.id, quantity: 2 }] }),
  });
  const completed = await request(`/businesses/${businessId}/orders/${order.order.id}/update_status`, {
    method: "PATCH", headers: auth, body: JSON.stringify({ status: "completed" }),
  });
  assert.equal(completed.order.status, "completed");
  await assert.rejects(
    request(`/businesses/${businessId}/orders/${order.order.id}/update_status`, { method: "PATCH", headers: auth, body: JSON.stringify({ status: "preparing" }) }),
    /409/,
  );
  await request(`/businesses/${businessId}/orders/${order.order.id}/update_status`, {
    method: "PATCH", headers: auth, body: JSON.stringify({ status: "completed" }),
  });
  const afterSale = await request(`/businesses/${businessId}/inventory/items`, { headers: auth });
  assert.equal(Number(afterSale.items.find((entry) => entry.id === item.item.id).current_quantity), 700);
  const cash = await request(`/businesses/${businessId}/cash_movements`, { headers: auth });
  assert.equal(cash.movements.filter((movement) => movement.order_id === order.order.id && movement.type === "sale" && Number(movement.amount) === 50).length, 1);
  const movement = await request(`/businesses/${businessId}/inventory/items/${item.item.id}/movements`, {
    method: "POST", headers: auth, body: JSON.stringify({ type: "loss", quantity: 200, description: "Teste de perda" }),
  });
  assert.equal(movement.movement.quantity, -200);
  await assert.rejects(
    request(`/businesses/${businessId}/inventory/items/${item.item.id}/movements`, { method: "POST", headers: auth, body: JSON.stringify({ type: "loss", quantity: 900 }) }),
    /409/,
  );

  const rollbackItems = await Promise.all(["Rollback A", "Rollback B"].map((name) => request(`/businesses/${businessId}/inventory/items`, {
    method: "POST", headers: auth, body: JSON.stringify({ name: `${name} ${suffix}`, unit: "unit", current_quantity: 0 }),
  })));
  const [firstItem, secondItem] = rollbackItems.map((result) => result.item).sort((left, right) => left.id.localeCompare(right.id));
  await request(`/businesses/${businessId}/purchases`, { method: "POST", headers: auth, body: JSON.stringify({ items: [{ inventory_item_id: firstItem.id, quantity: 10, unit_cost: 1 }] }) });
  const rollbackCategory = await request(`/businesses/${businessId}/categories`, { method: "POST", headers: auth, body: JSON.stringify({ name: `Rollback ${suffix}` }) });
  const rollbackProduct = await request(`/businesses/${businessId}/products`, { method: "POST", headers: auth, body: JSON.stringify({ name: `Rollback product ${suffix}`, price: 9, category_id: rollbackCategory.category.id }) });
  await request(`/businesses/${businessId}/products/${rollbackProduct.product.id}/recipe`, { method: "PUT", headers: auth, body: JSON.stringify({ ingredients: [{ inventory_item_id: secondItem.id, quantity: 1 }, { inventory_item_id: firstItem.id, quantity: 1 }] }) });
  const insufficientOrder = await request(`/businesses/${businessId}/orders`, { method: "POST", body: JSON.stringify({ items: [{ product_id: rollbackProduct.product.id, quantity: 1 }] }) });
  await assert.rejects(request(`/businesses/${businessId}/orders/${insufficientOrder.order.id}/update_status`, { method: "PATCH", headers: auth, body: JSON.stringify({ status: "completed" }) }), /409/);
  const rollbackInventory = await request(`/businesses/${businessId}/inventory/items`, { headers: auth });
  assert.equal(Number(rollbackInventory.items.find((entry) => entry.id === firstItem.id).current_quantity), 10);
  assert.equal(Number(rollbackInventory.items.find((entry) => entry.id === secondItem.id).current_quantity), 0);
  const savedOrders = await request(`/businesses/${businessId}/orders`, { headers: auth });
  assert.equal(savedOrders.orders.find((entry) => entry.id === insufficientOrder.order.id).status, "pending");
  const savedCash = await request(`/businesses/${businessId}/cash_movements`, { headers: auth });
  assert.equal(savedCash.movements.some((movementEntry) => movementEntry.order_id === insufficientOrder.order.id && movementEntry.type === "sale"), false);
});

integrationTest("API records purchases and updates weighted inventory cost", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const registered = await request("/auth/register", { method: "POST", body: JSON.stringify({ email: `purchase-${suffix}@example.test`, name: "Purchase Owner", password: "SecurePassword123" }) });
  const auth = { Authorization: `Bearer ${registered.token}` };
  const businessId = registered.business.id;
  const item = await request(`/businesses/${businessId}/inventory/items`, { method: "POST", headers: auth, body: JSON.stringify({ name: `Farinha ${suffix}`, unit: "kg", current_quantity: 10, cost_per_unit: 4 }) });
  const purchase = await request(`/businesses/${businessId}/purchases`, { method: "POST", headers: auth, body: JSON.stringify({ items: [{ inventory_item_id: item.item.id, quantity: 10, unit_cost: 6 }] }) });
  assert.equal(Number(purchase.purchase.total_cost), 60);
  const inventory = await request(`/businesses/${businessId}/inventory/items`, { headers: auth });
  const updated = inventory.items.find((row) => row.id === item.item.id);
  assert.equal(Number(updated.current_quantity), 20);
  assert.equal(Number(updated.cost_per_unit), 5);
  const fractional = await request(`/businesses/${businessId}/purchases`, { method: "POST", headers: auth, body: JSON.stringify({ items: [{ inventory_item_id: item.item.id, quantity: 0.15, unit_cost: 0.1 }] }) });
  assert.equal(fractional.purchase.total_cost, 0.02);
  assert.equal(fractional.purchase.items[0].total_cost, 0.02);
  const purchaseOrder = (await request(`/businesses/${businessId}/inventory/purchase-orders`, { method: "POST", headers: auth, body: JSON.stringify({ location_id: item.item.location_id, items: [{ inventory_item_id: item.item.id, quantity: 0.15, unit_cost: 0.1 }] }) })).purchase_order;
  const orderList = await request(`/businesses/${businessId}/inventory/purchase-orders`, { headers: auth });
  const line = orderList.purchase_orders.find((entry) => entry.id === purchaseOrder.id).items[0];
  const receipt = await request(`/businesses/${businessId}/inventory/purchase-orders/${purchaseOrder.id}/receipts`, { method: "POST", headers: { ...auth, "Idempotency-Key": randomUUID() }, body: JSON.stringify({ items: [{ order_item_id: line.id, quantity: 0.15 }] }) });
  assert.equal(receipt.receipt.total_cost, 0.02);
  assert.equal(receipt.receipt.items[0].total_cost, 0.02);
  const fineDirect = (await request(`/businesses/${businessId}/inventory/items`, { method: "POST", headers: auth, body: JSON.stringify({ name: "Fine direct", unit: "kg", current_quantity: 0.001, cost_per_unit: 0.0001 }) })).item;
  await request(`/businesses/${businessId}/purchases`, { method: "POST", headers: auth, body: JSON.stringify({ items: [{ inventory_item_id: fineDirect.id, quantity: 0.001, unit_cost: 0.0006 }] }) });
  const fineReceipt = (await request(`/businesses/${businessId}/inventory/items`, { method: "POST", headers: auth, body: JSON.stringify({ name: "Fine receipt", unit: "kg", current_quantity: 0.001, cost_per_unit: 0.0001 }) })).item;
  const fineOrder = (await request(`/businesses/${businessId}/inventory/purchase-orders`, { method: "POST", headers: auth, body: JSON.stringify({ location_id: fineReceipt.location_id, items: [{ inventory_item_id: fineReceipt.id, quantity: 0.001, unit_cost: 0.0006 }] }) })).purchase_order;
  const fineOrders = await request(`/businesses/${businessId}/inventory/purchase-orders`, { headers: auth });
  const fineLine = fineOrders.purchase_orders.find((entry) => entry.id === fineOrder.id).items[0];
  const fineReceived = await request(`/businesses/${businessId}/inventory/purchase-orders/${fineOrder.id}/receipts`, { method: "POST", headers: { ...auth, "Idempotency-Key": randomUUID() }, body: JSON.stringify({ items: [{ order_item_id: fineLine.id, quantity: 0.001 }] }) });
  const fineInventory = await request(`/businesses/${businessId}/inventory/items`, { headers: auth });
  assert.equal(Number(fineInventory.items.find((entry) => entry.id === fineDirect.id).cost_per_unit), 0.0004);
  assert.equal(Number(fineInventory.items.find((entry) => entry.id === fineReceipt.id).cost_per_unit), 0.0004);
  await request(`/businesses/${businessId}/inventory/purchase-receipts/${fineReceived.receipt.id}`, { method: "PATCH", headers: auth, body: JSON.stringify({ status: "reversed" }) });
  const reversedInventory = await request(`/businesses/${businessId}/inventory/items`, { headers: auth });
  assert.equal(Number(reversedInventory.items.find((entry) => entry.id === fineReceipt.id).cost_per_unit), 0.0002);
});

integrationTest("API manages cash sessions, payment methods, customers and suppliers", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const registered = await request("/auth/register", {
    method: "POST", body: JSON.stringify({ email: `operations-${suffix}@example.test`, name: "Operations Owner", password: "SecurePassword123" }),
  });
  const auth = { Authorization: `Bearer ${registered.token}` };
  const businessId = registered.business.id;
  for (const opening_amount of [true, "0x10", "1e3", null, ""]) {
    await assert.rejects(request(`/businesses/${businessId}/cash-register/open`, { method: "POST", headers: auth, body: JSON.stringify({ opening_amount }) }), /400/);
  }
  const method = await request(`/businesses/${businessId}/payment-methods`, { method: "POST", headers: auth, body: JSON.stringify({ name: `Cash ${suffix}` }) });
  assert.equal(method.method.name, `Cash ${suffix}`);
  const category = await request(`/businesses/${businessId}/categories`, { method: "POST", headers: auth, body: JSON.stringify({ name: `Payment ${suffix}` }) });
  const product = await request(`/businesses/${businessId}/products`, { method: "POST", headers: auth, body: JSON.stringify({ name: `Product ${suffix}`, price: 10, category_id: category.category.id }) });
  const paymentOrder = await request(`/businesses/${businessId}/orders`, { method: "POST", body: JSON.stringify({ payment_method_id: method.method.id, items: [{ product_id: product.product.id, quantity: 1 }] }) });
  assert.equal(paymentOrder.order.payment_method_id, method.method.id);
  const opened = await request(`/businesses/${businessId}/cash-register/open`, { method: "POST", headers: auth, body: JSON.stringify({ opening_amount: 100 }) });
  assert.equal((await request(`/businesses/${businessId}/cash-register/current`, { headers: auth })).session.id, opened.session.id);
  await request(`/businesses/${businessId}/cash_movements`, { method: "POST", headers: auth, body: JSON.stringify({ type: "entry", amount: 10, description: "Cash test movement" }) });
  const customer = await request(`/businesses/${businessId}/customers`, { method: "POST", headers: auth, body: JSON.stringify({ customer: { name: `Customer ${suffix}`, phone: "5511999999999" } }) });
  assert.equal(customer.customer.name, `Customer ${suffix}`);
  const oversizedCustomerNotes = await fetch(`${base}/businesses/${businessId}/customers`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ customer: { name: "Oversized notes", notes: "x".repeat(16 * 1024 + 1) } }) });
  assert.equal(oversizedCustomerNotes.status, 400);
  const invalidCustomerEmail = await fetch(`${base}/businesses/${businessId}/customers`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ customer: { name: "Invalid email", email: "not-an-email" } }) });
  assert.equal(invalidCustomerEmail.status, 400);
  const supplier = await request(`/businesses/${businessId}/suppliers`, { method: "POST", headers: auth, body: JSON.stringify({ supplier: { name: `Supplier ${suffix}` } }) });
  assert.equal(supplier.supplier.name, `Supplier ${suffix}`);
  const invalidSupplierFieldType = await fetch(`${base}/businesses/${businessId}/suppliers`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ supplier: { name: "Invalid phone", phone: { value: "123" } } }) });
  assert.equal(invalidSupplierFieldType.status, 400);
  const closePath = `/businesses/${businessId}/cash-register/${opened.session.id}/close`;
  const closes = await Promise.allSettled([
    request(closePath, { method: "POST", headers: auth, body: JSON.stringify({ closing_amount: 110 }) }),
    request(closePath, { method: "POST", headers: auth, body: JSON.stringify({ closing_amount: 110 }) }),
  ]);
  assert.equal(closes.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(closes.filter((result) => result.status === "rejected" && /404/.test(result.reason.message)).length, 1);
  const closed = closes.find((result) => result.status === "fulfilled").value;
  assert.equal(closed.closed, true);
  assert.equal(closed.reconciliation.expected_amount, 110);
  assert.equal(closed.reconciliation.difference_amount, 0);
  await assert.rejects(
    request(`/businesses/${businessId}/cash_movements`, { method: "POST", headers: auth, body: JSON.stringify({ type: "entry", amount: 5 }) }),
    /409/,
  );
});

integrationTest("API applies discounts and protects loyalty point redemption", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const registered = await request("/auth/register", { method: "POST", body: JSON.stringify({ email: `value-${suffix}@example.test`, name: "Value Owner", password: "SecurePassword123" }) });
  const auth = { Authorization: `Bearer ${registered.token}` };
  const businessId = registered.business.id;
  const discount = await request(`/businesses/${businessId}/discounts`, { method: "POST", headers: auth, body: JSON.stringify({ discount: { name: "Ten percent", code: `TEN${suffix.slice(-6)}`, type: "percentage", value: 10 } }) });
  const preview = await request(`/businesses/${businessId}/discounts/preview`, { method: "POST", headers: auth, body: JSON.stringify({ code: discount.discount.name === "Ten percent" ? `TEN${suffix.slice(-6)}` : "", subtotal: 100 }) });
  assert.equal(preview.discount.amount, 10);
  const category = await request(`/businesses/${businessId}/categories`, { method: "POST", headers: auth, body: JSON.stringify({ name: `Value category ${suffix}` }) });
  const product = await request(`/businesses/${businessId}/products`, { method: "POST", headers: auth, body: JSON.stringify({ name: `Discounted product ${suffix}`, price: 100, category_id: category.category.id }) });
  const discountedOrder = await request(`/businesses/${businessId}/orders`, { method: "POST", headers: auth, body: JSON.stringify({ items: [{ product_id: product.product.id, quantity: 1 }], discount_code: `TEN${suffix.slice(-6)}` }) });
  assert.equal(discountedOrder.order.discount_amount, 10);
  assert.equal(discountedOrder.order.total, 90);
  const fractionalProduct = await request(`/businesses/${businessId}/products`, { method: "POST", headers: auth, body: JSON.stringify({ name: "Fractional price", price: 0.3, category_id: category.category.id }) });
  const fractionalOrder = await request(`/businesses/${businessId}/orders`, { method: "POST", body: JSON.stringify({ items: [{ product_id: fractionalProduct.product.id, quantity: 0.15 }], discount_code: `TEN${suffix.slice(-6)}` }) });
  assert.equal(fractionalOrder.order.subtotal, 0.05);
  assert.equal(fractionalOrder.order.discount_amount, 0.01);
  assert.equal(fractionalOrder.order.total, 0.04);
  const fractionalPreview = await request(`/businesses/${businessId}/discounts/preview`, { method: "POST", headers: auth, body: JSON.stringify({ code: `TEN${suffix.slice(-6)}`, subtotal: 0.05 }) });
  assert.equal(fractionalPreview.discount.amount, 0.01);
  assert.equal(fractionalPreview.discount.total, 0.04);
  const customer = await request(`/businesses/${businessId}/customers`, { method: "POST", headers: auth, body: JSON.stringify({ customer: { name: `Loyal ${suffix}` } }) });
  const earned = await request(`/businesses/${businessId}/customers/${customer.customer.id}/loyalty/earn`, { method: "POST", headers: auth, body: JSON.stringify({ points: 100 }) });
  assert.equal(Number(earned.points), 100);
  const redemptionPath = `/businesses/${businessId}/customers/${customer.customer.id}/loyalty/redeem`;
  const simultaneousRedemptions = await Promise.allSettled([
    request(redemptionPath, { method: "POST", headers: auth, body: JSON.stringify({ points: 80 }) }),
    request(redemptionPath, { method: "POST", headers: auth, body: JSON.stringify({ points: 80 }) }),
  ]);
  assert.equal(simultaneousRedemptions.filter((attempt) => attempt.status === "fulfilled").length, 1);
  assert.equal(simultaneousRedemptions.filter((attempt) => attempt.status === "rejected" && /409/.test(attempt.reason.message)).length, 1);
  const balance = await request(`/businesses/${businessId}/customers/${customer.customer.id}/loyalty`, { headers: auth });
  assert.equal(Number(balance.account.points), 20);
  await assert.rejects(request(`/businesses/${businessId}/customers/${customer.customer.id}/loyalty/redeem`, { method: "POST", headers: auth, body: JSON.stringify({ points: 100 }) }), /409/);
  const excessiveRedemption = await fetch(`${base}${redemptionPath}`, { method: "POST", headers: auth, body: JSON.stringify({ points: 1000001 }) });
  assert.equal(excessiveRedemption.status, 400);
});

integrationTest("API returns isolated sales and critical-stock reports", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const registered = await request("/auth/register", { method: "POST", body: JSON.stringify({ email: `report-${suffix}@example.test`, name: "Report Owner", password: "SecurePassword123" }) });
  const auth = { Authorization: `Bearer ${registered.token}` };
  const businessId = registered.business.id;
  const sales = await request(`/businesses/${businessId}/reports/sales`, { headers: auth });
  const stock = await request(`/businesses/${businessId}/reports/critical-stock`, { headers: auth });
  assert.equal(sales.summary.orders, 0);
  assert.deepEqual(stock.items, []);
  const item = (await request(`/businesses/${businessId}/inventory/items`, { method: "POST", headers: auth, body: JSON.stringify({ name: "Report ingredient", unit: "kg", current_quantity: 10, minimum_quantity: 2 }) })).item;
  const before = await request(`/businesses/${businessId}/reports/critical-stock`, { headers: auth });
  assert.equal(before.items.some((row) => row.id === item.id), false);
  await pool.query("UPDATE inventory_locations SET active = FALSE WHERE id = ? AND business_id = ?", [item.location_id, businessId]);
  const after = await request(`/businesses/${businessId}/reports/critical-stock`, { headers: auth });
  assert.equal(Number(after.items.find((row) => row.id === item.id)?.current_quantity), 0);
});

integrationTest("API lists backups and rejects unsafe restore paths", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const registered = await request("/auth/register", { method: "POST", body: JSON.stringify({ email: `backup-${suffix}@example.test`, name: "Backup Owner", password: "SecurePassword123" }) });
  const auth = { Authorization: `Bearer ${registered.token}` };
  const businessId = registered.business.id;
  await assert.rejects(request(`/businesses/${businessId}/backups`, { headers: auth }), /403/);
  await assert.rejects(request(`/businesses/${businessId}/backups`, { method: "POST", headers: auth }), /403/);
  await assert.rejects(request(`/businesses/${businessId}/backups/restore`, { method: "POST", headers: auth, body: JSON.stringify({ name: "..\\outside.sql" }) }), /400/);
  await assert.rejects(request(`/businesses/${businessId}/backups/restore`, { method: "POST", headers: auth, body: JSON.stringify({ name: "food-system-2026-10-29T12-00-00-000Z-01234567-89ab-cdef-0123-456789abcdef.sql.enc" }) }), /403/);
});

integrationTest("API returns CMV and gross margin from product recipes", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const registered = await request("/auth/register", { method: "POST", body: JSON.stringify({ email: `margin-${suffix}@example.test`, name: "Margin Owner", password: "SecurePassword123" }) });
  const auth = { Authorization: `Bearer ${registered.token}` };
  const businessId = registered.business.id;
  const category = await request(`/businesses/${businessId}/categories`, { method: "POST", headers: auth, body: JSON.stringify({ name: `Margin ${suffix}` }) });
  const product = await request(`/businesses/${businessId}/products`, { method: "POST", headers: auth, body: JSON.stringify({ name: `Prato ${suffix}`, price: 20, category_id: category.category.id }) });
  const item = await request(`/businesses/${businessId}/inventory/items`, { method: "POST", headers: auth, body: JSON.stringify({ name: `Insumo ${suffix}`, unit: "unit", current_quantity: 10, cost_per_unit: 5 }) });
  await request(`/businesses/${businessId}/products/${product.product.id}/recipe`, { method: "PUT", headers: auth, body: JSON.stringify({ ingredients: [{ inventory_item_id: item.item.id, quantity: 1 }] }) });
  const completedOrder = await request(`/businesses/${businessId}/orders`, { method: "POST", body: JSON.stringify({ items: [{ product_id: product.product.id, quantity: 2 }, { product_id: product.product.id, quantity: 1 }] }) });
  await request(`/businesses/${businessId}/orders/${completedOrder.order.id}/update_status`, { method: "PATCH", headers: auth, body: JSON.stringify({ status: "completed" }) });
  await request(`/businesses/${businessId}/orders`, { method: "POST", body: JSON.stringify({ items: [{ product_id: product.product.id, quantity: 1 }] }) });
  const discountCode = `RPT${suffix.slice(-6)}`;
  await request(`/businesses/${businessId}/discounts`, { method: "POST", headers: auth, body: JSON.stringify({ name: `Report discount ${suffix}`, code: discountCode, type: "percentage", value: 10 }) });
  const discounted = await request(`/businesses/${businessId}/orders`, { method: "POST", body: JSON.stringify({ items: [{ product_id: product.product.id, quantity: 1 }], discount_code: discountCode }) });
  await request(`/businesses/${businessId}/orders/${discounted.order.id}/update_status`, { method: "PATCH", headers: auth, body: JSON.stringify({ status: "completed" }) });
  const report = await request(`/businesses/${businessId}/reports/profitability`, { headers: auth });
  assert.equal(report.revenue, 78);
  assert.equal(report.cogs, 20);
  assert.equal(report.gross_profit, 58);
  assert.equal(report.gross_margin, 74.36);
  const sales = await request(`/businesses/${businessId}/reports/sales`, { headers: auth });
  assert.equal(sales.summary.orders, 2);
  assert.equal(sales.summary.revenue, 78);
  assert.equal(sales.summary.average_ticket, 39);
  const productSales = sales.products.find((entry) => entry.name === product.product.name);
  assert.equal(Number(productSales.quantity), 4);
  assert.equal(Number(productSales.revenue), 78);
  const today = await request(`/businesses/${businessId}/orders/today_stats`, { headers: auth });
  assert.equal(today.orders, 3);
  assert.equal(today.total, 78);
  const cash = await request(`/businesses/${businessId}/cash_movements`, { headers: auth });
  assert.equal(cash.movements.filter((movement) => movement.type === "sale").length, 2);
  assert.equal(cash.movements.filter((movement) => movement.type === "sale").reduce((sum, movement) => sum + Number(movement.amount), 0), 78);
});

integrationTest("API audits administrative mutations and rotates sessions on login", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const email = `security-${suffix}@example.test`;
  const registered = await request("/auth/register", { method: "POST", body: JSON.stringify({ email, name: "Security Owner", password: "SecurePassword123" }) });
  const auth = { Authorization: `Bearer ${registered.token}` };
  const businessId = registered.business.id;
  await request(`/businesses/${businessId}/categories`, { method: "POST", headers: auth, body: JSON.stringify({ name: `Audit ${suffix}` }) });
  let auditRows = [];
  // onResponse runs after the client receives the response; allow the audit write to finish.
  for (let attempt = 0; attempt < 40 && !auditRows.length; attempt += 1) {
    [auditRows] = await pool.query(
      "SELECT action, user_id, business_id FROM audit_logs WHERE user_id = ? AND business_id = ? AND action = ? LIMIT 1",
      [registered.user.id, businessId, "HTTP POST /api/v1/businesses/:businessId/categories"],
    );
    if (!auditRows.length) await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(auditRows.length, 1);

  const login = await request("/auth/login", { method: "POST", body: JSON.stringify({ email, password: "SecurePassword123" }) });
  assert.notEqual(login.token, registered.token);
  const oldSession = await fetch(`${base}/businesses/${businessId}/categories`, { headers: auth });
  assert.equal(oldSession.status, 401);
  const currentSession = await request(`/businesses/${businessId}/categories`, { headers: { Authorization: `Bearer ${login.token}` } });
  assert.ok(Array.isArray(currentSession.categories));
});

integrationTest("API routes kitchen orders by station", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const registered = await request("/auth/register", { method: "POST", body: JSON.stringify({ email: `kitchen-${suffix}@example.test`, name: "Kitchen Owner", password: "SecurePassword123" }) });
  const auth = { Authorization: `Bearer ${registered.token}` };
  const businessId = registered.business.id;
  await assert.rejects(request(`/businesses/${businessId}/kitchen-stations`, { method: "POST", headers: auth, body: JSON.stringify({ name: `Unsafe ${suffix}`, printer_url: "http://10.0.0.5:9100" }) }), /400/);
  const station = await request(`/businesses/${businessId}/kitchen-stations`, { method: "POST", headers: auth, body: JSON.stringify({ name: `Grill ${suffix}` }) });
  const category = await request(`/businesses/${businessId}/categories`, { method: "POST", headers: auth, body: JSON.stringify({ name: `Kitchen ${suffix}` }) });
  const product = await request(`/businesses/${businessId}/products`, { method: "POST", headers: auth, body: JSON.stringify({ name: `Station product ${suffix}`, price: 15, category_id: category.category.id, kitchen_station_id: station.station.id }) });
  const order = await request(`/businesses/${businessId}/orders`, { method: "POST", body: JSON.stringify({ items: [{ product_id: product.product.id, quantity: 1 }] }) });
  const filtered = await request(`/businesses/${businessId}/orders?station_id=${station.station.id}`, { headers: auth });
  assert.equal(filtered.orders.some((row) => row.id === order.order.id), true);
  const kitchenFiltered = await request(`/businesses/${businessId}/orders?view=kitchen&station_id=${station.station.id}`, { headers: auth });
  assert.equal(kitchenFiltered.orders.some((row) => row.id === order.order.id), true);
  await pool.query("UPDATE orders SET status = 'completed' WHERE id = ?", [order.order.id]);
  const finished = await request(`/businesses/${businessId}/orders?view=kitchen&station_id=${station.station.id}`, { headers: auth });
  assert.equal(finished.orders.some((row) => row.id === order.order.id), false);
});
