import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const enabled = Boolean(process.env.FOOD_SYSTEM_API_URL && !process.env.FOOD_SYSTEM_TEST_AUTO_DATA_DIR && (process.env.FOOD_SYSTEM_DATA_DIR || process.env.FOOD_SYSTEM_DB_PATH));
const integrationTest = enabled ? test : test.skip;
const { pool } = enabled ? await import("../src/db.js") : { pool: null };
const base = process.env.FOOD_SYSTEM_API_URL || "";
const call = async (path, { method = "GET", token, body, expected = 200, idempotencyKey } = {}) => {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}), ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(data)}`);
  return data;
};

test.after(async () => { await pool?.end(); });

integrationTest("inventory transfers retain lot traceability, reorder alerts and stock count approval", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const owner = await call("/auth/register", { method: "POST", expected: 201, body: { email: `inventory-owner-${suffix}@example.test`, name: "Inventory Owner", password: "SecurePassword123" } });
  const manager = await call("/auth/register", { method: "POST", expected: 201, body: { email: `inventory-manager-${suffix}@example.test`, name: "Inventory Manager", password: "SecurePassword123" } });
  const business = owner.business.id;
  await call(`/businesses/${business}/team`, { method: "POST", token: owner.token, expected: 201, body: { email: manager.user.email, name: manager.user.name, role: "manager" } });

  const source = (await call(`/businesses/${business}/inventory/locations`, { token: owner.token })).locations[0];
  const defaultLocationItem = (await call(`/businesses/${business}/inventory/items`, { method: "POST", token: owner.token, expected: 201, body: { name: `Default location ${suffix}`, unit: "unit" } })).item;
  assert.equal(defaultLocationItem.location_id, source.id, "the item response reports the default location selected by the server");
  const destination = (await call(`/businesses/${business}/inventory/locations`, { method: "POST", token: owner.token, expected: 201, body: { name: `Prep ${suffix}`, code: `P${suffix.slice(-8)}` } })).location;
  const ingredient = (await call(`/businesses/${business}/inventory/items`, { method: "POST", token: owner.token, expected: 201, body: { name: `Flour ${suffix}`, unit: "kg", current_quantity: 20, minimum_quantity: 1, location_id: source.id } })).item;

  const transfer = (await call(`/businesses/${business}/inventory/transfers`, { method: "POST", token: owner.token, expected: 201, body: { from_location_id: source.id, to_location_id: destination.id, items: [{ inventory_item_id: ingredient.id, quantity: 5 }] } })).transfer;
  await call(`/businesses/${business}/inventory/transfers/${transfer.id}`, { method: "PATCH", token: owner.token, body: { status: "in_transit" } });
  await call(`/businesses/${business}/inventory/transfers/${transfer.id}`, { method: "PATCH", token: owner.token, body: { status: "received" } });
  let balances = (await call(`/businesses/${business}/inventory/balances?location_id=${source.id}`, { token: owner.token })).items;
  assert.equal(Number(balances.find((item) => item.id === ingredient.id).current_quantity), 15);
  balances = (await call(`/businesses/${business}/inventory/balances?location_id=${destination.id}`, { token: owner.token })).items;
  assert.equal(Number(balances.find((item) => item.id === ingredient.id).current_quantity), 5);
  const history = (await call(`/businesses/${business}/inventory/transfers`, { token: owner.token })).transfers;
  assert.equal(history.find((item) => item.id === transfer.id).items[0].lot_code, `ABERTURA-${ingredient.id}`);

  await call(`/businesses/${business}/inventory/reorder-settings`, { method: "PUT", token: owner.token, body: { items: [{ location_id: destination.id, inventory_item_id: ingredient.id, minimum_quantity: 6, reorder_quantity: 10, lead_time_days: 2 }] } });
  const locationBalances = (await call(`/businesses/${business}/inventory/balances?location_id=${destination.id}`, { token: owner.token })).items;
  assert.equal(Number(locationBalances.find((item) => item.id === ingredient.id).minimum_quantity), 6, "the inventory table receives the location-specific minimum");
  const alerts = (await call(`/businesses/${business}/inventory/reorder?location_id=${destination.id}`, { token: owner.token })).items;
  assert.equal(alerts.find((item) => item.inventory_item_id === ingredient.id).reorder_quantity, 10);

  const oil = (await call(`/businesses/${business}/inventory/items`, { method: "POST", token: owner.token, expected: 201, body: { name: `Oil ${suffix}`, unit: "l", current_quantity: 0, location_id: destination.id } })).item;
  await call(`/businesses/${business}/inventory/items/${oil.id}`, { method: "PATCH", token: owner.token, body: { active: false } });
  assert.equal((await call(`/businesses/${business}/inventory/items`, { token: owner.token })).items.find((item) => item.id === oil.id).active, 0);
  await call(`/businesses/${business}/inventory/items/${oil.id}`, { method: "PATCH", token: owner.token, body: { active: true } });
  const purchaseOrder = (await call(`/businesses/${business}/inventory/purchase-orders`, { method: "POST", token: owner.token, expected: 201, body: { location_id: destination.id, items: [{ inventory_item_id: oil.id, quantity: 10, unit_cost: 2.5 }] } })).purchase_order;
  const orderLine = (await call(`/businesses/${business}/inventory/purchase-orders`, { token: owner.token })).purchase_orders.find((entry) => entry.id === purchaseOrder.id).items[0];
  await call(`/businesses/${business}/inventory/purchase-orders/${purchaseOrder.id}/receipts`, { method: "POST", token: owner.token, expected: 400, idempotencyKey: randomUUID(), body: { items: [{ order_item_id: orderLine.id, quantity: 1, expires_at: "2026-02-31" }] } });
  const receiptKey = randomUUID();
  const receiptBody = { items: [{ order_item_id: orderLine.id, quantity: 4, lot_code: `OIL-${suffix}`, expires_at: "2030-01-01" }] };
  const firstReceipt = (await call(`/businesses/${business}/inventory/purchase-orders/${purchaseOrder.id}/receipts`, { method: "POST", token: owner.token, expected: 201, idempotencyKey: receiptKey, body: receiptBody })).receipt;
  const replayedReceipt = (await call(`/businesses/${business}/inventory/purchase-orders/${purchaseOrder.id}/receipts`, { method: "POST", token: owner.token, expected: 201, idempotencyKey: receiptKey, body: receiptBody })).receipt;
  assert.equal(replayedReceipt.id, firstReceipt.id, "retrying an idempotent receipt must return the original receipt");
  const secondReceipt = (await call(`/businesses/${business}/inventory/purchase-orders/${purchaseOrder.id}/receipts`, { method: "POST", token: owner.token, expected: 201, idempotencyKey: randomUUID(), body: { items: [{ order_item_id: orderLine.id, quantity: 3, lot_code: `OIL-${suffix}`, expires_at: "2030-01-01" }] } })).receipt;
  assert.equal(secondReceipt.purchase_order_status, "partial");
  await call(`/businesses/${business}/inventory/purchase-receipts/${secondReceipt.id}`, { method: "PATCH", token: owner.token, body: { status: "reversed" } });
  const oilBalances = (await call(`/businesses/${business}/inventory/balances?location_id=${destination.id}`, { token: owner.token })).items;
  assert.equal(Number(oilBalances.find((item) => item.id === oil.id).current_quantity), 4);
  const refreshedOrder = (await call(`/businesses/${business}/inventory/purchase-orders`, { token: owner.token })).purchase_orders.find((entry) => entry.id === purchaseOrder.id);
  assert.equal(refreshedOrder.items[0].received_quantity, 4);
  assert.equal(refreshedOrder.receipts.find((receipt) => receipt.id === secondReceipt.id).status, "reversed");
  assert.equal(firstReceipt.status, "received");
  await call(`/businesses/${business}/inventory/purchase-orders/${purchaseOrder.id}/receipts`, { method: "POST", token: owner.token, expected: 201, idempotencyKey: randomUUID(), body: { items: [{ order_item_id: orderLine.id, quantity: 1, lot_code: `EXPIRED-${suffix}`, expires_at: "2020-01-01" }] } });
  const oilAfterExpiredReceipt = (await call(`/businesses/${business}/inventory/balances?location_id=${destination.id}`, { token: owner.token })).items;
  assert.equal(Number(oilAfterExpiredReceipt.find((item) => item.id === oil.id).current_quantity), 4, "expired ingredients are excluded from available balances");

  const count = (await call(`/businesses/${business}/inventory/stock-counts`, { method: "POST", token: manager.token, expected: 201, body: { location_id: destination.id } })).stock_count;
  const snapshot = (await call(`/businesses/${business}/inventory/stock-counts/${count.id}`, { token: manager.token })).stock_count;
  await call(`/businesses/${business}/inventory/stock-counts/${count.id}`, { method: "PATCH", token: manager.token, body: { status: "submitted", items: snapshot.items.map((item) => ({ inventory_item_id: item.inventory_item_id, counted_quantity: 4, reason: "Physical count" })) } });
  await call(`/businesses/${business}/inventory/stock-counts/${count.id}`, { method: "PATCH", token: manager.token, expected: 409, body: { status: "approved" } });
  await call(`/businesses/${business}/inventory/stock-counts/${count.id}`, { method: "PATCH", token: owner.token, body: { status: "approved" } });
  balances = (await call(`/businesses/${business}/inventory/balances?location_id=${destination.id}`, { token: owner.token })).items;
  assert.equal(Number(balances.find((item) => item.id === ingredient.id).current_quantity), 4);

  const category = (await call(`/businesses/${business}/categories`, { method: "POST", token: owner.token, expected: 201, body: { name: `Inventory ${suffix}` } })).category;
  const product = (await call(`/businesses/${business}/products`, { method: "POST", token: owner.token, expected: 201, body: { name: `Recipe ${suffix}`, price: 10, category_id: category.id } })).product;
  const table = (await call(`/businesses/${business}/tables`, { method: "POST", token: owner.token, expected: 201, body: { name: `Table ${suffix}` } })).table;
  await call(`/businesses/${business}/products/${product.id}/recipe`, { method: "PUT", token: owner.token, body: { ingredients: [{ inventory_item_id: ingredient.id, quantity: 1 }] } });
  await call(`/businesses/${business}/inventory/production-orders`, { method: "POST", token: owner.token, expected: 400, body: { product_id: product.id, location_id: destination.id, batch_code: `INVALID-${suffix}`, planned_quantity: 1, expires_at: "2026-02-31" } });
  const order = (await call(`/businesses/${business}/orders`, { method: "POST", expected: 201, body: { table_token: table.public_token, items: [{ product_id: product.id, quantity: 2 }], idempotency_key: randomUUID() } })).order;
  await call(`/businesses/${business}/orders/${order.id}/update_status`, { method: "PATCH", token: owner.token, body: { status: "confirmed" } });
  await call(`/businesses/${business}/inventory/items/${ingredient.id}/movements`, { method: "POST", token: owner.token, expected: 201, body: { type: "loss", quantity: 15, location_id: source.id } });
  await call(`/businesses/${business}/inventory/items/${ingredient.id}/movements`, { method: "POST", token: owner.token, expected: 409, body: { type: "loss", quantity: 3, location_id: destination.id } });
  await call(`/businesses/${business}/orders/${order.id}/update_status`, { method: "PATCH", token: owner.token, body: { status: "completed" } });

  const batchCode = `BATCH-${suffix}`;
  const production = (await call(`/businesses/${business}/inventory/production-orders`, { method: "POST", token: owner.token, expected: 201, body: { product_id: product.id, location_id: destination.id, batch_code: batchCode, planned_quantity: 0.5 } })).production_order;
  await call(`/businesses/${business}/inventory/production-orders/${production.id}`, { method: "PATCH", token: owner.token, body: { status: "in_progress" } });
  await call(`/businesses/${business}/inventory/production-orders/${production.id}`, { method: "PATCH", token: owner.token, body: { status: "completed", actual_quantity: 0.4 } });
  const productionHistory = (await call(`/businesses/${business}/inventory/production-orders`, { token: owner.token })).production_orders;
  assert.equal(productionHistory.find((entry) => entry.id === production.id).waste_quantity, 0.1);
  assert.equal(productionHistory.find((entry) => entry.id === production.id).yield_percent, 80);
  assert.equal(productionHistory.find((entry) => entry.id === production.id).stock_quantity, 0.4);
  assert.equal(productionHistory.find((entry) => entry.id === production.id).available_quantity, 0.4);
  assert.equal(productionHistory.find((entry) => entry.id === production.id).location_name, `Prep ${suffix}`);
  const finishedLotId = productionHistory.find((entry) => entry.id === production.id).stock_lot_id;
  const reservedPreparedOrder = (await call(`/businesses/${business}/orders`, { method: "POST", expected: 201, body: { table_token: table.public_token, items: [{ product_id: product.id, quantity: 0.4 }], idempotency_key: randomUUID() } })).order;
  await call(`/businesses/${business}/orders/${reservedPreparedOrder.id}/update_status`, { method: "PATCH", token: owner.token, body: { status: "confirmed" } });
  await call(`/businesses/${business}/inventory/product-lots/${finishedLotId}`, { method: "PATCH", token: owner.token, expected: 409, body: { status: "quarantined" } });
  await call(`/businesses/${business}/inventory/product-lots/${finishedLotId}`, { method: "PATCH", token: owner.token, expected: 409, body: { status: "recalled" } });
  await call(`/businesses/${business}/orders/${reservedPreparedOrder.id}/update_status`, { method: "PATCH", token: owner.token, body: { status: "cancelled" } });
  await call(`/businesses/${business}/inventory/product-lots/${finishedLotId}`, { method: "PATCH", token: owner.token, body: { status: "quarantined" } });
  assert.equal((await call(`/businesses/${business}/inventory/production-orders`, { token: owner.token })).production_orders.find((entry) => entry.id === production.id).available_quantity, 0);
  await call(`/businesses/${business}/inventory/product-lots/${finishedLotId}`, { method: "PATCH", token: owner.token, body: { status: "active" } });
  const beforePreparedSale = (await call(`/businesses/${business}/inventory/balances?location_id=${destination.id}`, { token: owner.token })).items.find((item) => item.id === ingredient.id).current_quantity;
  const preparedOrder = (await call(`/businesses/${business}/orders`, { method: "POST", expected: 201, body: { table_token: table.public_token, items: [{ product_id: product.id, quantity: 0.4 }], idempotency_key: randomUUID() } })).order;
  await call(`/businesses/${business}/orders/${preparedOrder.id}/update_status`, { method: "PATCH", token: owner.token, body: { status: "confirmed" } });
  await call(`/businesses/${business}/orders/${preparedOrder.id}/update_status`, { method: "PATCH", token: owner.token, body: { status: "completed" } });
  const afterPreparedSale = (await call(`/businesses/${business}/inventory/balances?location_id=${destination.id}`, { token: owner.token })).items.find((item) => item.id === ingredient.id).current_quantity;
  assert.equal(Number(afterPreparedSale), Number(beforePreparedSale), "selling a prepared batch must not consume its recipe ingredients a second time");
  const recallBatch = (await call(`/businesses/${business}/inventory/production-orders`, { token: owner.token })).production_orders.find((entry) => entry.id === production.id);
  assert.equal(recallBatch.stock_quantity, 0);
  const secondBatch = (await call(`/businesses/${business}/inventory/production-orders`, { method: "POST", token: owner.token, expected: 201, body: { product_id: product.id, location_id: destination.id, batch_code: `RECALL-${suffix}`, planned_quantity: 0.1, expires_at: "2020-01-01" } })).production_order;
  await call(`/businesses/${business}/inventory/production-orders/${secondBatch.id}`, { method: "PATCH", token: owner.token, body: { status: "in_progress" } });
  await call(`/businesses/${business}/inventory/production-orders/${secondBatch.id}`, { method: "PATCH", token: owner.token, body: { status: "completed", actual_quantity: 0.1 } });
  const recalledProduction = (await call(`/businesses/${business}/inventory/production-orders`, { token: owner.token })).production_orders.find((entry) => entry.id === secondBatch.id);
  assert.equal(recalledProduction.stock_quantity, 0.1);
  assert.equal(recalledProduction.available_quantity, 0, "expired finished stock must not be reported as available");
  assert.equal(recalledProduction.is_expired, 1, "the API supplies the same expiry decision used by inventory transactions");
  await call(`/businesses/${business}/inventory/product-lots/${recalledProduction.stock_lot_id}`, { method: "PATCH", token: owner.token, body: { status: "recalled" } });
  const recalledHistory = (await call(`/businesses/${business}/inventory/production-orders`, { token: owner.token })).production_orders.find((entry) => entry.id === secondBatch.id);
  assert.equal(recalledHistory.stock_lot_status, "recalled");

  await call(`/businesses/${business}/products/${product.id}/recipe`, { method: "PUT", token: owner.token, body: { ingredients: [{ inventory_item_id: oil.id, quantity: 1 }] } });
  const oilOrder = (await call(`/businesses/${business}/orders`, { method: "POST", expected: 201, body: { table_token: table.public_token, items: [{ product_id: product.id, quantity: 1 }], idempotency_key: randomUUID() } })).order;
  await call(`/businesses/${business}/orders/${oilOrder.id}/update_status`, { method: "PATCH", token: owner.token, body: { status: "confirmed" } });
  await call(`/businesses/${business}/inventory/purchase-receipts/${firstReceipt.id}`, { method: "PATCH", token: owner.token, expected: 409, body: { status: "reversed" } });
  await call(`/businesses/${business}/orders/${oilOrder.id}/update_status`, { method: "PATCH", token: owner.token, body: { status: "cancelled" } });

  for (const status of ["quarantined", "recalled"]) {
    const stockItem = (await call(`/businesses/${business}/inventory/items`, { method: "POST", token: owner.token, expected: 201, body: { name: `${status} receipt ${suffix}`, unit: "kg", current_quantity: 0, location_id: destination.id } })).item;
    const stockOrder = (await call(`/businesses/${business}/inventory/purchase-orders`, { method: "POST", token: owner.token, expected: 201, body: { location_id: destination.id, items: [{ inventory_item_id: stockItem.id, quantity: 2, unit_cost: 3 }] } })).purchase_order;
    const stockLine = (await call(`/businesses/${business}/inventory/purchase-orders`, { token: owner.token })).purchase_orders.find((entry) => entry.id === stockOrder.id).items[0];
    const stockReceipt = (await call(`/businesses/${business}/inventory/purchase-orders/${stockOrder.id}/receipts`, { method: "POST", token: owner.token, expected: 201, idempotencyKey: randomUUID(), body: { items: [{ order_item_id: stockLine.id, quantity: 2, lot_code: `${status}-${suffix}` }] } })).receipt;
    const stockLot = (await call(`/businesses/${business}/inventory/lots`, { token: owner.token })).lots.find((lot) => lot.inventory_item_id === stockItem.id);
    await call(`/businesses/${business}/inventory/lots/${stockLot.id}`, { method: "PATCH", token: owner.token, body: { status } });
    await call(`/businesses/${business}/inventory/purchase-receipts/${stockReceipt.id}`, { method: "PATCH", token: owner.token, body: { status: "reversed" } });
    const refreshedStockItem = (await call(`/businesses/${business}/inventory/items`, { token: owner.token })).items.find((item) => item.id === stockItem.id);
    assert.equal(Number(refreshedStockItem.current_quantity), 0, `reversing a ${status} receipt must update the ingredient total`);
    assert.equal(Number(refreshedStockItem.cost_per_unit), 3, `reversing a ${status} receipt must retain the unit cost after the stock was already removed from availability`);
    const refreshedStockLot = (await call(`/businesses/${business}/inventory/lots`, { token: owner.token })).lots.find((lot) => lot.id === stockLot.id);
    assert.equal(Number(refreshedStockLot.current_quantity), 0);
    assert.equal(refreshedStockLot.status, status === "recalled" ? "recalled" : "depleted", "receipt reversal preserves recalled as a terminal lot status");
  }

  const lots = (await call(`/businesses/${business}/inventory/lots`, { token: owner.token })).lots.filter((lot) => lot.inventory_item_id === ingredient.id && lot.location_id === destination.id && lot.current_quantity > 0);
  assert.equal(lots.length, 1);
  await call(`/businesses/${business}/inventory/lots/${lots[0].id}`, { method: "PATCH", token: owner.token, body: { status: "quarantined" } });
  balances = (await call(`/businesses/${business}/inventory/balances?location_id=${destination.id}`, { token: owner.token })).items;
  assert.equal(Number(balances.find((item) => item.id === ingredient.id).current_quantity), 0);
  await call(`/businesses/${business}/inventory/lots/${lots[0].id}`, { method: "PATCH", token: owner.token, body: { status: "active" } });
  await call(`/businesses/${business}/inventory/lots/${lots[0].id}`, { method: "PATCH", token: owner.token, body: { status: "recalled" } });
  await call(`/businesses/${business}/inventory/lots/${lots[0].id}`, { method: "PATCH", token: owner.token, expected: 409, body: { status: "active" } });
  balances = (await call(`/businesses/${business}/inventory/balances?location_id=${destination.id}`, { token: owner.token })).items;
  assert.equal(Number(balances.find((item) => item.id === ingredient.id).current_quantity), 0);
  const allLocationBalances = (await call(`/businesses/${business}/inventory/balances`, { token: owner.token })).items;
  assert.equal(Number(allLocationBalances.find((item) => item.id === ingredient.id).current_quantity), 0, "all-location totals exclude quarantined and recalled stock");

  const staleCount = (await call(`/businesses/${business}/inventory/stock-counts`, { method: "POST", token: manager.token, expected: 201, body: { location_id: destination.id } })).stock_count;
  const staleSnapshot = (await call(`/businesses/${business}/inventory/stock-counts/${staleCount.id}`, { token: manager.token })).stock_count;
  await call(`/businesses/${business}/inventory/items/${oil.id}/movements`, { method: "POST", token: owner.token, expected: 201, body: { type: "adjustment", direction: 1, quantity: 1, location_id: destination.id } });
  await call(`/businesses/${business}/inventory/stock-counts/${staleCount.id}`, { method: "PATCH", token: manager.token, body: { status: "submitted", items: staleSnapshot.items.map((item) => ({ inventory_item_id: item.inventory_item_id, counted_quantity: item.expected_quantity, reason: "Snapshot preserved" })) } });
  await call(`/businesses/${business}/inventory/stock-counts/${staleCount.id}`, { method: "PATCH", token: owner.token, expected: 409, body: { status: "approved" } });
});
