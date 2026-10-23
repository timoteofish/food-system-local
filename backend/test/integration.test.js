import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { pool } from "../src/db.js";

const base = process.env.FOOD_SYSTEM_API_URL || "http://127.0.0.1:3000/api/v1";
const request = async (path, options = {}) => {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  assert.equal(response.ok, true, `${options.method || "GET"} ${path}: ${response.status} ${text}`);
  return data;
};

test.after(async () => {
  await pool.end();
});

test("API completes the local restaurant operation flow", async () => {
  const health = await request("/health");
  assert.deepEqual(health, { status: "ok", database: "ok" });

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const registered = await request("/auth/register", {
    method: "POST",
    body: JSON.stringify({ email: `integration-${suffix}@example.test`, name: "Integration Owner", password: "SenhaSegura123" }),
  });
  assert.ok(registered.token);
  const auth = { Authorization: `Bearer ${registered.token}` };
  const businessId = registered.business.id;

  const profile = await request("/auth/profile", { headers: auth });
  assert.equal(profile.user.email, registered.user.email);

  const category = await request(`/businesses/${businessId}/categories`, {
    method: "POST", headers: auth, body: JSON.stringify({ name: "Integração" }),
  });
  const product = await request(`/businesses/${businessId}/products`, {
    method: "POST", headers: auth, body: JSON.stringify({ name: "Produto de teste", price: 12.5, category_id: category.category.id }),
  });
  const table = await request(`/businesses/${businessId}/tables`, {
    method: "POST", headers: auth, body: JSON.stringify({ name: "Mesa integração" }),
  });
  const menu = await request(`/menu/${table.table.public_token}`);
  assert.equal(menu.table.id, table.table.id);
  assert.equal(menu.categories[0].products[0].id, product.product.id);

  const order = await request(`/businesses/${businessId}/orders`, {
    method: "POST", body: JSON.stringify({ table_token: table.table.public_token, items: [{ product_id: product.product.id, quantity: 2 }] }),
  });
  assert.equal(order.order.total, 25);
  const ticket = await request(`/businesses/${businessId}/orders/${order.order.id}/print`, { headers: auth });
  assert.equal(ticket.ticket.items[0].name, "Produto de teste");
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
    method: "POST", headers: auth, body: JSON.stringify({ type: "entry", amount: 25, description: "Integração" }),
  });
  assert.equal(movement.movement.amount, 25);

  const team = await request(`/businesses/${businessId}/team`, { headers: auth });
  assert.equal(team.members.length, 1);
});

test("API rejects anonymous business creation and assigns the authenticated owner", async () => {
  await assert.rejects(request("/businesses", { method: "POST", body: JSON.stringify({ name: "Anonymous business" }) }), /401/);
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const registered = await request("/auth/register", { method: "POST", body: JSON.stringify({ email: `business-${suffix}@example.test`, name: "Business Owner", password: "SenhaSegura123" }) });
  const created = await request("/businesses", { method: "POST", headers: { Authorization: `Bearer ${registered.token}` }, body: JSON.stringify({ name: `Second business ${suffix}` }) });
  assert.equal(created.business.name, `Second business ${suffix}`);
  const team = await request(`/businesses/${created.business.id}/team`, { headers: { Authorization: `Bearer ${registered.token}` } });
  assert.equal(team.members[0].role, "owner");
});

test("API validates and persists split order payments", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const registered = await request("/auth/register", { method: "POST", body: JSON.stringify({ email: `split-${suffix}@example.test`, name: "Split Owner", password: "SenhaSegura123" }) });
  const auth = { Authorization: `Bearer ${registered.token}` };
  const businessId = registered.business.id;
  const category = await request(`/businesses/${businessId}/categories`, { method: "POST", headers: auth, body: JSON.stringify({ name: `Split ${suffix}` }) });
  const product = await request(`/businesses/${businessId}/products`, { method: "POST", headers: auth, body: JSON.stringify({ name: `Produto ${suffix}`, price: 20, category_id: category.category.id }) });
  const pix = await request(`/businesses/${businessId}/payment-methods`, { method: "POST", headers: auth, body: JSON.stringify({ name: `Pix ${suffix}` }) });
  const card = await request(`/businesses/${businessId}/payment-methods`, { method: "POST", headers: auth, body: JSON.stringify({ name: `Card ${suffix}` }) });
  const order = await request(`/businesses/${businessId}/orders`, { method: "POST", body: JSON.stringify({ items: [{ product_id: product.product.id, quantity: 2 }], payments: [{ payment_method_id: pix.method.id, amount: 15 }, { payment_method_id: card.method.id, amount: 25 }] }) });
  const orders = await request(`/businesses/${businessId}/orders`, { headers: auth });
  const saved = orders.orders.find((row) => row.id === order.order.id);
  assert.equal(saved.payments.length, 2);
  assert.equal(saved.payments.reduce((sum, payment) => sum + Number(payment.amount), 0), 40);
});

test("API assigns and advances a local delivery", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const registered = await request("/auth/register", { method: "POST", body: JSON.stringify({ email: `courier-${suffix}@example.test`, name: "Courier Owner", password: "SenhaSegura123" }) });
  const auth = { Authorization: `Bearer ${registered.token}` };
  const businessId = registered.business.id;
  const courier = await request(`/businesses/${businessId}/couriers`, { method: "POST", headers: auth, body: JSON.stringify({ name: "João Entregador", phone: "71999999999" }) });
  const category = await request(`/businesses/${businessId}/categories`, { method: "POST", headers: auth, body: JSON.stringify({ name: `Courier ${suffix}` }) });
  const product = await request(`/businesses/${businessId}/products`, { method: "POST", headers: auth, body: JSON.stringify({ name: `Delivery ${suffix}`, price: 18, category_id: category.category.id }) });
  const order = await request(`/businesses/${businessId}/orders`, { method: "POST", body: JSON.stringify({ items: [{ product_id: product.product.id, quantity: 1 }], delivery: { address: { street: "Rua A", number: "1", city: "Salvador" }, fee: 2 } }) });
  const assigned = await request(`/businesses/${businessId}/orders/${order.order.id}/delivery`, { method: "POST", headers: auth, body: JSON.stringify({ courier_id: courier.courier.id }) });
  assert.equal(assigned.delivery.status, "assigned");
  const courierToken = await request(`/businesses/${businessId}/couriers/${courier.courier.id}/token`, { method: "POST", headers: auth, body: JSON.stringify({}) });
  const courierDeliveries = await fetch(`${base}/courier/deliveries`, { headers: { "X-Courier-Token": courierToken.token } });
  assert.equal(courierDeliveries.status, 200);
  const courierPayload = await courierDeliveries.json();
  assert.equal(courierPayload.deliveries[0].id, assigned.delivery.id);
  const locationResponse = await fetch(`${base}/courier/location`, { method: "POST", headers: { "Content-Type": "application/json", "X-Courier-Token": courierToken.token }, body: JSON.stringify({ latitude: -12.9714, longitude: -38.5014, accuracy_m: 12 }) });
  assert.equal(locationResponse.status, 200);
  const locations = await request(`/businesses/${businessId}/couriers/locations`, { headers: auth });
  assert.equal(Number(locations.locations.find((row) => row.courier_id === courier.courier.id).latitude), -12.9714);
  const advancedCourier = await fetch(`${base}/courier/deliveries/${assigned.delivery.id}`, { method: "PATCH", headers: { "Content-Type": "application/json", "X-Courier-Token": courierToken.token }, body: JSON.stringify({ status: "picked_up" }) });
  assert.equal(advancedCourier.status, 200);
  const listed = await request(`/businesses/${businessId}/deliveries`, { headers: auth });
  assert.equal(listed.deliveries[0].courier_name, "João Entregador");
});

test("API creates a scheduled delivery with validated address and fee", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const registered = await request("/auth/register", { method: "POST", body: JSON.stringify({ email: `delivery-${suffix}@example.test`, name: "Delivery Owner", password: "SenhaSegura123" }) });
  const auth = { Authorization: `Bearer ${registered.token}` };
  const businessId = registered.business.id;
  const category = await request(`/businesses/${businessId}/categories`, { method: "POST", headers: auth, body: JSON.stringify({ name: `Delivery ${suffix}` }) });
  const product = await request(`/businesses/${businessId}/products`, { method: "POST", headers: auth, body: JSON.stringify({ name: `Lanche ${suffix}`, price: 20, category_id: category.category.id }) });
  const delivery = await request(`/businesses/${businessId}/orders`, {
    method: "POST",
    body: JSON.stringify({ items: [{ product_id: product.product.id, quantity: 1 }], delivery: { address: { street: "Rua Central", number: "10", city: "Salvador" }, fee: 5, scheduled_for: "2030-01-01T12:00:00.000Z" } }),
  });
  assert.equal(delivery.order.total, 25);
  assert.equal(delivery.order.delivery_address.city, "Salvador");
  assert.equal(Number(delivery.order.delivery_fee), 5);
});

test("API rejects cross-business administrative access", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const first = await request("/auth/register", {
    method: "POST", body: JSON.stringify({ email: `first-${suffix}@example.test`, name: "First Owner", password: "SenhaSegura123" }),
  });
  const second = await request("/auth/register", {
    method: "POST", body: JSON.stringify({ email: `second-${suffix}@example.test`, name: "Second Owner", password: "SenhaSegura123" }),
  });
  await assert.rejects(
    request(`/businesses/${second.business.id}/categories`, { headers: { Authorization: `Bearer ${first.token}` } }),
    /403/,
  );
});

test("API opens, transfers and closes dining tabs", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const registered = await request("/auth/register", { method: "POST", body: JSON.stringify({ email: `tabs-${suffix}@example.test`, name: "Tabs Owner", password: "SenhaSegura123" }) });
  const auth = { Authorization: `Bearer ${registered.token}` };
  const businessId = registered.business.id;
  const first = await request(`/businesses/${businessId}/tables`, { method: "POST", headers: auth, body: JSON.stringify({ name: `Table A ${suffix}` }) });
  const second = await request(`/businesses/${businessId}/tables`, { method: "POST", headers: auth, body: JSON.stringify({ name: `Table B ${suffix}` }) });
  const opened = await request(`/businesses/${businessId}/tables/${first.table.id}/dining-tabs`, { method: "POST", headers: auth, body: JSON.stringify({}) });
  assert.equal(opened.tab.restaurant_table_id, first.table.id);
  const transferred = await request(`/businesses/${businessId}/dining-tabs/${opened.tab.id}/transfer`, { method: "POST", headers: auth, body: JSON.stringify({ table_id: second.table.id }) });
  assert.equal(transferred.tab.table_id, second.table.id);
  const closed = await request(`/businesses/${businessId}/dining-tabs/${opened.tab.id}/close`, { method: "POST", headers: auth, body: JSON.stringify({}) });
  assert.equal(closed.tab.status, "closed");
});

test("API ingests an external order idempotently", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const registered = await request("/auth/register", {
    method: "POST", body: JSON.stringify({ email: `external-${suffix}@example.test`, name: "External Owner", password: "SenhaSegura123" }),
  });
  const auth = { Authorization: `Bearer ${registered.token}` };
  const businessId = registered.business.id;
  const connection = await request(`/businesses/${businessId}/integrations`, {
    method: "POST", headers: auth, body: JSON.stringify({ provider: "99food", display_name: "99Food principal" }),
  });
  const webhookSecret = `webhook-${suffix}-secret`;
  await request(`/businesses/${businessId}/integrations/${connection.connection.id}/credentials`, {
    method: "POST", headers: auth, body: JSON.stringify({ credentials: { webhook_secret: webhookSecret } }),
  });
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

  const category = await request(`/businesses/${businessId}/categories`, { method: "POST", headers: auth, body: JSON.stringify({ name: `Marketplace ${suffix}` }) });
  const product = await request(`/businesses/${businessId}/products`, { method: "POST", headers: auth, body: JSON.stringify({ name: `Marketplace item ${suffix}`, price: 42.5, category_id: category.category.id }) });
  const localOrder = await request(`/businesses/${businessId}/orders`, { method: "POST", body: JSON.stringify({ items: [{ product_id: product.product.id, quantity: 1 }] }) });
  const linked = await request(`/businesses/${businessId}/external-orders/${first.external_order.id}`, { method: "PATCH", headers: auth, body: JSON.stringify({ order_id: localOrder.order.id, status: "accepted" }) });
  assert.equal(linked.external_order.order_id, localOrder.order.id);
  assert.equal(linked.external_order.status, "accepted");
  const localOrders = await request(`/businesses/${businessId}/orders`, { headers: auth });
  assert.equal(localOrders.orders.find((order) => order.id === localOrder.order.id).status, "confirmed");

  const invalidResponse = await fetch(`${base}/businesses/${businessId}/integrations/${connection.connection.id}/events`, { method: "POST", headers: { "Content-Type": "application/json", "X-Integration-Signature": `sha256=${"0".repeat(64)}` }, body: eventBody });
  assert.equal(invalidResponse.status, 401);

  const externalOrders = await request(`/businesses/${businessId}/external-orders`, { headers: auth });
  assert.equal(externalOrders.orders.length, 1);
  assert.equal(externalOrders.orders[0].provider, "99food");
});

test("API manages inventory movements and product recipes", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const registered = await request("/auth/register", {
    method: "POST", body: JSON.stringify({ email: `stock-${suffix}@example.test`, name: "Stock Owner", password: "SenhaSegura123" }),
  });
  const auth = { Authorization: `Bearer ${registered.token}` };
  const businessId = registered.business.id;
  const item = await request(`/businesses/${businessId}/inventory/items`, {
    method: "POST", headers: auth, body: JSON.stringify({ name: `Carne ${suffix}`, unit: "g", current_quantity: 1000 }),
  });
  const category = await request(`/businesses/${businessId}/categories`, {
    method: "POST", headers: auth, body: JSON.stringify({ name: `Estoque ${suffix}` }),
  });
  const product = await request(`/businesses/${businessId}/products`, {
    method: "POST", headers: auth, body: JSON.stringify({ name: `Hambúrguer ${suffix}`, price: 25, category_id: category.category.id }),
  });
  const recipe = await request(`/businesses/${businessId}/products/${product.product.id}/recipe`, {
    method: "PUT", headers: auth, body: JSON.stringify({ ingredients: [{ inventory_item_id: item.item.id, quantity: 150 }] }),
  });
  assert.equal(recipe.saved, true);
  const order = await request(`/businesses/${businessId}/orders`, {
    method: "POST", body: JSON.stringify({ items: [{ product_id: product.product.id, quantity: 2 }] }),
  });
  const completed = await request(`/businesses/${businessId}/orders/${order.order.id}/update_status`, {
    method: "PATCH", headers: auth, body: JSON.stringify({ status: "completed" }),
  });
  assert.equal(completed.order.status, "completed");
  const afterSale = await request(`/businesses/${businessId}/inventory/items`, { headers: auth });
  assert.equal(Number(afterSale.items.find((entry) => entry.id === item.item.id).current_quantity), 700);
  const cash = await request(`/businesses/${businessId}/cash_movements`, { headers: auth });
  assert.ok(cash.movements.some((movement) => movement.order_id === order.order.id && movement.type === "sale" && Number(movement.amount) === 50));
  const movement = await request(`/businesses/${businessId}/inventory/items/${item.item.id}/movements`, {
    method: "POST", headers: auth, body: JSON.stringify({ type: "loss", quantity: 200, description: "Teste de perda" }),
  });
  assert.equal(movement.movement.quantity, -200);
  await assert.rejects(
    request(`/businesses/${businessId}/inventory/items/${item.item.id}/movements`, { method: "POST", headers: auth, body: JSON.stringify({ type: "loss", quantity: 900 }) }),
    /409/,
  );
});

test("API records purchases and updates weighted inventory cost", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const registered = await request("/auth/register", { method: "POST", body: JSON.stringify({ email: `purchase-${suffix}@example.test`, name: "Purchase Owner", password: "SenhaSegura123" }) });
  const auth = { Authorization: `Bearer ${registered.token}` };
  const businessId = registered.business.id;
  const item = await request(`/businesses/${businessId}/inventory/items`, { method: "POST", headers: auth, body: JSON.stringify({ name: `Farinha ${suffix}`, unit: "kg", current_quantity: 10, cost_per_unit: 4 }) });
  const purchase = await request(`/businesses/${businessId}/purchases`, { method: "POST", headers: auth, body: JSON.stringify({ items: [{ inventory_item_id: item.item.id, quantity: 10, unit_cost: 6 }] }) });
  assert.equal(Number(purchase.purchase.total_cost), 60);
  const inventory = await request(`/businesses/${businessId}/inventory/items`, { headers: auth });
  const updated = inventory.items.find((row) => row.id === item.item.id);
  assert.equal(Number(updated.current_quantity), 20);
  assert.equal(Number(updated.cost_per_unit), 5);
});

test("API manages cash sessions, payment methods, customers and suppliers", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const registered = await request("/auth/register", {
    method: "POST", body: JSON.stringify({ email: `operations-${suffix}@example.test`, name: "Operations Owner", password: "SenhaSegura123" }),
  });
  const auth = { Authorization: `Bearer ${registered.token}` };
  const businessId = registered.business.id;
  const method = await request(`/businesses/${businessId}/payment-methods`, { method: "POST", headers: auth, body: JSON.stringify({ name: `Cash ${suffix}` }) });
  assert.equal(method.method.name, `Cash ${suffix}`);
  const category = await request(`/businesses/${businessId}/categories`, { method: "POST", headers: auth, body: JSON.stringify({ name: `Payment ${suffix}` }) });
  const product = await request(`/businesses/${businessId}/products`, { method: "POST", headers: auth, body: JSON.stringify({ name: `Product ${suffix}`, price: 10, category_id: category.category.id }) });
  const paymentOrder = await request(`/businesses/${businessId}/orders`, { method: "POST", body: JSON.stringify({ payment_method_id: method.method.id, items: [{ product_id: product.product.id, quantity: 1 }] }) });
  assert.equal(paymentOrder.order.payment_method_id, method.method.id);
  const opened = await request(`/businesses/${businessId}/cash-register/open`, { method: "POST", headers: auth, body: JSON.stringify({ opening_amount: 100 }) });
  assert.equal((await request(`/businesses/${businessId}/cash-register/current`, { headers: auth })).session.id, opened.session.id);
  const customer = await request(`/businesses/${businessId}/customers`, { method: "POST", headers: auth, body: JSON.stringify({ customer: { name: `Customer ${suffix}`, phone: "5511999999999" } }) });
  assert.equal(customer.customer.name, `Customer ${suffix}`);
  const supplier = await request(`/businesses/${businessId}/suppliers`, { method: "POST", headers: auth, body: JSON.stringify({ supplier: { name: `Supplier ${suffix}` } }) });
  assert.equal(supplier.supplier.name, `Supplier ${suffix}`);
  const closed = await request(`/businesses/${businessId}/cash-register/${opened.session.id}/close`, { method: "POST", headers: auth, body: JSON.stringify({ closing_amount: 100 }) });
  assert.equal(closed.closed, true);
  assert.equal(closed.reconciliation.expected_amount, 100);
  assert.equal(closed.reconciliation.difference_amount, 0);
});

test("API applies discounts and protects loyalty point redemption", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const registered = await request("/auth/register", { method: "POST", body: JSON.stringify({ email: `value-${suffix}@example.test`, name: "Value Owner", password: "SenhaSegura123" }) });
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
  const customer = await request(`/businesses/${businessId}/customers`, { method: "POST", headers: auth, body: JSON.stringify({ customer: { name: `Loyal ${suffix}` } }) });
  const earned = await request(`/businesses/${businessId}/customers/${customer.customer.id}/loyalty/earn`, { method: "POST", headers: auth, body: JSON.stringify({ points: 100 }) });
  assert.equal(Number(earned.points), 100);
  const redeemed = await request(`/businesses/${businessId}/customers/${customer.customer.id}/loyalty/redeem`, { method: "POST", headers: auth, body: JSON.stringify({ points: 40 }) });
  assert.equal(Number(redeemed.points), 60);
  await assert.rejects(request(`/businesses/${businessId}/customers/${customer.customer.id}/loyalty/redeem`, { method: "POST", headers: auth, body: JSON.stringify({ points: 100 }) }), /409/);
});

test("API returns isolated sales and critical-stock reports", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const registered = await request("/auth/register", { method: "POST", body: JSON.stringify({ email: `report-${suffix}@example.test`, name: "Report Owner", password: "SenhaSegura123" }) });
  const auth = { Authorization: `Bearer ${registered.token}` };
  const businessId = registered.business.id;
  const sales = await request(`/businesses/${businessId}/reports/sales`, { headers: auth });
  const stock = await request(`/businesses/${businessId}/reports/critical-stock`, { headers: auth });
  assert.equal(sales.summary.orders, 0);
  assert.deepEqual(stock.items, []);
});

test("API lists backups and rejects unsafe restore paths", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const registered = await request("/auth/register", { method: "POST", body: JSON.stringify({ email: `backup-${suffix}@example.test`, name: "Backup Owner", password: "SenhaSegura123" }) });
  const auth = { Authorization: `Bearer ${registered.token}` };
  const businessId = registered.business.id;
  const backups = await request(`/businesses/${businessId}/backups`, { headers: auth });
  assert.ok(Array.isArray(backups.backups));
  await assert.rejects(request(`/businesses/${businessId}/backups/restore`, { method: "POST", headers: auth, body: JSON.stringify({ name: "..\\outside.sql" }) }), /400/);
});

test("API returns CMV and gross margin from product recipes", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const registered = await request("/auth/register", { method: "POST", body: JSON.stringify({ email: `margin-${suffix}@example.test`, name: "Margin Owner", password: "SenhaSegura123" }) });
  const auth = { Authorization: `Bearer ${registered.token}` };
  const businessId = registered.business.id;
  const category = await request(`/businesses/${businessId}/categories`, { method: "POST", headers: auth, body: JSON.stringify({ name: `Margin ${suffix}` }) });
  const product = await request(`/businesses/${businessId}/products`, { method: "POST", headers: auth, body: JSON.stringify({ name: `Prato ${suffix}`, price: 20, category_id: category.category.id }) });
  const item = await request(`/businesses/${businessId}/inventory/items`, { method: "POST", headers: auth, body: JSON.stringify({ name: `Insumo ${suffix}`, unit: "unit", current_quantity: 10, cost_per_unit: 5 }) });
  await request(`/businesses/${businessId}/products/${product.product.id}/recipe`, { method: "PUT", headers: auth, body: JSON.stringify({ ingredients: [{ inventory_item_id: item.item.id, quantity: 1 }] }) });
  await request(`/businesses/${businessId}/orders`, { method: "POST", body: JSON.stringify({ items: [{ product_id: product.product.id, quantity: 2 }] }) });
  const report = await request(`/businesses/${businessId}/reports/profitability`, { headers: auth });
  assert.equal(report.revenue, 40);
  assert.equal(report.cogs, 10);
  assert.equal(report.gross_profit, 30);
  assert.equal(report.gross_margin, 75);
});

test("API audits administrative mutations and rotates sessions on login", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const email = `security-${suffix}@example.test`;
  const registered = await request("/auth/register", { method: "POST", body: JSON.stringify({ email, name: "Security Owner", password: "SenhaSegura123" }) });
  const auth = { Authorization: `Bearer ${registered.token}` };
  const businessId = registered.business.id;
  await request(`/businesses/${businessId}/categories`, { method: "POST", headers: auth, body: JSON.stringify({ name: `Audit ${suffix}` }) });
  const [auditRows] = await pool.query("SELECT action, user_id, business_id FROM audit_logs WHERE user_id = ? AND business_id = ? ORDER BY created_at DESC LIMIT 10", [registered.user.id, businessId]);
  assert.ok(auditRows.some((row) => row.action.includes("POST") && row.action.includes("categories")));

  const login = await request("/auth/login", { method: "POST", body: JSON.stringify({ email, password: "SenhaSegura123" }) });
  assert.notEqual(login.token, registered.token);
  const oldSession = await fetch(`${base}/businesses/${businessId}/categories`, { headers: auth });
  assert.equal(oldSession.status, 401);
  const currentSession = await request(`/businesses/${businessId}/categories`, { headers: { Authorization: `Bearer ${login.token}` } });
  assert.ok(Array.isArray(currentSession.categories));
});

test("API routes kitchen orders by station", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const registered = await request("/auth/register", { method: "POST", body: JSON.stringify({ email: `kitchen-${suffix}@example.test`, name: "Kitchen Owner", password: "SenhaSegura123" }) });
  const auth = { Authorization: `Bearer ${registered.token}` };
  const businessId = registered.business.id;
  await assert.rejects(request(`/businesses/${businessId}/kitchen-stations`, { method: "POST", headers: auth, body: JSON.stringify({ name: `Unsafe ${suffix}`, printer_url: "http://10.0.0.5:9100" }) }), /400/);
  const station = await request(`/businesses/${businessId}/kitchen-stations`, { method: "POST", headers: auth, body: JSON.stringify({ name: `Grill ${suffix}` }) });
  const category = await request(`/businesses/${businessId}/categories`, { method: "POST", headers: auth, body: JSON.stringify({ name: `Kitchen ${suffix}` }) });
  const product = await request(`/businesses/${businessId}/products`, { method: "POST", headers: auth, body: JSON.stringify({ name: `Station product ${suffix}`, price: 15, category_id: category.category.id, kitchen_station_id: station.station.id }) });
  const order = await request(`/businesses/${businessId}/orders`, { method: "POST", body: JSON.stringify({ items: [{ product_id: product.product.id, quantity: 1 }] }) });
  const filtered = await request(`/businesses/${businessId}/orders?station_id=${station.station.id}`, { headers: auth });
  assert.equal(filtered.orders.some((row) => row.id === order.order.id), true);
});
