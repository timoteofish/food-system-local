import test from "node:test";
import assert from "node:assert/strict";

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

  const updated = await request(`/businesses/${businessId}/orders/${order.order.id}/update_status`, {
    method: "PATCH", headers: auth, body: JSON.stringify({ status: "confirmed" }),
  });
  assert.equal(updated.order.status, "confirmed");

  const movement = await request(`/businesses/${businessId}/cash_movements`, {
    method: "POST", headers: auth, body: JSON.stringify({ type: "entry", amount: 25, description: "Integração" }),
  });
  assert.equal(movement.movement.amount, 25);

  const team = await request(`/businesses/${businessId}/team`, { headers: auth });
  assert.equal(team.members.length, 1);
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
  const event = { event_type: "order.received", external_order_id: `99food-${suffix}`, payload: { total: 42.5, items: [] } };
  const first = await request(`/businesses/${businessId}/integrations/${connection.connection.id}/events`, {
    method: "POST", headers: auth, body: JSON.stringify(event),
  });
  const second = await request(`/businesses/${businessId}/integrations/${connection.connection.id}/events`, {
    method: "POST", headers: auth, body: JSON.stringify(event),
  });
  assert.equal(first.event.status, "processed");
  assert.equal(second.external_order.id, first.external_order.id);

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
