import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { pool } from "../src/db.js";

const base = process.env.FOOD_SYSTEM_API_URL || "http://127.0.0.1:3000/api/v1";
const request = async (path, options = {}) => {
  if ((options.method || "GET").toUpperCase() === "POST" && /\/orders$/.test(path) && typeof options.body === "string") {
    const body = JSON.parse(options.body);
    body.idempotency_key ||= randomUUID();
    options = { ...options, body: JSON.stringify(body) };
  }
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
  await request(`/businesses/${businessId}`, {
    method: "PATCH", headers: auth,
    body: JSON.stringify({ settings: { gradient_start: "#112233", gradient_end: "#334455", gradient_angle: 45, menu_banner: "Bem-vindo", show_all_products: false, selected_categories: ["Integração"], api_token: "must-not-be-public" } }),
  });
  const menu = await request(`/menu/${table.table.public_token}`);
  assert.equal(menu.table.id, table.table.id);
  assert.equal(menu.categories[0].products[0].id, product.product.id);
  assert.equal(menu.business_id, businessId);
  assert.equal(menu.business_name, registered.business.name);
  assert.equal(menu.products[0].id, product.product.id);
  assert.equal(menu.gradient_start, "#112233");
  assert.deepEqual(menu.selected_categories, ["Integração"]);
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

test("managers can remove staff but cannot remove peer managers", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const owner = await request("/auth/register", { method: "POST", body: JSON.stringify({ email: `team-owner-${suffix}@example.test`, name: "Team Owner", password: "SenhaSegura123" }) });
  const manager = await request("/auth/register", { method: "POST", body: JSON.stringify({ email: `team-manager-${suffix}@example.test`, name: "Team Manager", password: "SenhaSegura123" }) });
  const staff = await request("/auth/register", { method: "POST", body: JSON.stringify({ email: `team-staff-${suffix}@example.test`, name: "Team Staff", password: "SenhaSegura123" }) });
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

test("team invitations reject unsupported roles and values beyond identity column limits", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const owner = await request("/auth/register", { method: "POST", body: JSON.stringify({ email: `team-validation-${suffix}@example.test`, name: "Team Validation Owner", password: "SenhaSegura123" }) });
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

test("API allows only one concurrent cash register opening per business", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const registered = await request("/auth/register", { method: "POST", body: JSON.stringify({ email: `cash-lock-${suffix}@example.test`, name: "Cash Lock Owner", password: "SenhaSegura123" }) });
  const auth = { Authorization: `Bearer ${registered.token}` };
  const path = `/businesses/${registered.business.id}/cash-register/open`;
  const attempts = await Promise.allSettled([
    request(path, { method: "POST", headers: auth, body: JSON.stringify({ opening_amount: 0 }) }),
    request(path, { method: "POST", headers: auth, body: JSON.stringify({ opening_amount: 0 }) }),
  ]);
  assert.equal(attempts.filter((attempt) => attempt.status === "fulfilled").length, 1);
  assert.equal(attempts.filter((attempt) => attempt.status === "rejected" && /409/.test(attempt.reason.message)).length, 1);
});

test("API rejects orders beyond supported item and decimal limits", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const registered = await request("/auth/register", { method: "POST", body: JSON.stringify({ email: `order-limit-${suffix}@example.test`, name: "Order Limit Owner", password: "SenhaSegura123" }) });
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

test("API validates and persists split order payments", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const registered = await request("/auth/register", { method: "POST", body: JSON.stringify({ email: `split-${suffix}@example.test`, name: "Split Owner", password: "SenhaSegura123" }) });
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
  await assert.rejects(request(`/businesses/${businessId}/products`, { method: "POST", headers: auth, body: JSON.stringify({ name: `Preço fracionário ${suffix}`, price: 1.005, category_id: category.category.id }) }), /400/);
  await assert.rejects(request(`/businesses/${businessId}/cash-register/open`, { method: "POST", headers: auth, body: JSON.stringify({ opening_amount: 10.005 }) }), /400/);
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
  const deliveryPath = `/businesses/${businessId}/orders/${order.order.id}/delivery`;
  const assignments = await Promise.allSettled([
    request(deliveryPath, { method: "POST", headers: auth, body: JSON.stringify({ courier_id: courier.courier.id }) }),
    request(deliveryPath, { method: "POST", headers: auth, body: JSON.stringify({ courier_id: courier.courier.id }) }),
  ]);
  assert.equal(assignments.filter((attempt) => attempt.status === "fulfilled").length, 1);
  assert.equal(assignments.filter((attempt) => attempt.status === "rejected" && /409/.test(attempt.reason.message)).length, 1);
  const assigned = assignments.find((attempt) => attempt.status === "fulfilled").value;
  assert.equal(assigned.delivery.status, "assigned");
  const courierToken = await request(`/businesses/${businessId}/couriers/${courier.courier.id}/token`, { method: "POST", headers: auth, body: JSON.stringify({}) });
  const courierDeliveries = await fetch(`${base}/courier/deliveries`, { headers: { "X-Courier-Token": courierToken.token } });
  assert.equal(courierDeliveries.status, 200);
  const courierPayload = await courierDeliveries.json();
  assert.equal(courierPayload.deliveries[0].id, assigned.delivery.id);
  const courierRegression = await fetch(`${base}/courier/deliveries/${assigned.delivery.id}`, { method: "PATCH", headers: { "Content-Type": "application/json", "X-Courier-Token": courierToken.token }, body: JSON.stringify({ status: "assigned" }) });
  assert.equal(courierRegression.status, 409);
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
  const completedCourier = await fetch(`${base}/courier/deliveries/${assigned.delivery.id}`, { method: "PATCH", headers: { "Content-Type": "application/json", "X-Courier-Token": courierToken.token }, body: JSON.stringify({ status: "delivered" }) });
  assert.equal(completedCourier.status, 200);
  const locationAfterDelivery = await fetch(`${base}/courier/location`, { method: "POST", headers: { "Content-Type": "application/json", "X-Courier-Token": courierToken.token }, body: JSON.stringify({ latitude: -12.9716, longitude: -38.5016 }) });
  assert.equal(locationAfterDelivery.status, 409);
  const locationsAfterDelivery = await request(`/businesses/${businessId}/couriers/locations`, { headers: auth });
  assert.equal(locationsAfterDelivery.locations.find((row) => row.courier_id === courier.courier.id).latitude, null);
  const listed = await request(`/businesses/${businessId}/deliveries`, { headers: auth });
  assert.equal(listed.deliveries[0].courier_name, "João Entregador");
});

test("API creates a scheduled delivery with validated address and fee", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const registered = await request("/auth/register", { method: "POST", body: JSON.stringify({ email: `delivery-${suffix}@example.test`, name: "Delivery Owner", password: "SenhaSegura123" }) });
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
  const retryResponse = await fetch(`${base}/businesses/${businessId}/orders`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(orderRequest) });
  assert.equal(retryResponse.status, 200);
  const retry = await retryResponse.json();
  assert.equal(retry.order.id, delivery.order.id);
  const mismatchedRetry = await fetch(`${base}/businesses/${businessId}/orders`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...orderRequest, order: { customer_name: "Another customer" } }) });
  assert.equal(mismatchedRetry.status, 409);
  assert.equal(delivery.order.total, 25);
  assert.equal(delivery.order.delivery_address.city, "Salvador");
  assert.equal(Number(delivery.order.delivery_fee), 5);
  assert.equal(delivery.order.customer_name, "Maria Silva");
  const listed = await request(`/businesses/${businessId}/orders`, { headers: auth });
  assert.equal(listed.orders.find((row) => row.id === delivery.order.id).customer_name, "Maria Silva");
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

test("API prevents products from referencing another business category or kitchen station", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const first = await request("/auth/register", { method: "POST", body: JSON.stringify({ email: `catalog-a-${suffix}@example.test`, name: "Catalog A", password: "SenhaSegura123" }) });
  const second = await request("/auth/register", { method: "POST", body: JSON.stringify({ email: `catalog-b-${suffix}@example.test`, name: "Catalog B", password: "SenhaSegura123" }) });
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

test("API opens, transfers and closes dining tabs", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const registered = await request("/auth/register", { method: "POST", body: JSON.stringify({ email: `tabs-${suffix}@example.test`, name: "Tabs Owner", password: "SenhaSegura123" }) });
  const auth = { Authorization: `Bearer ${registered.token}` };
  const businessId = registered.business.id;
  const first = await request(`/businesses/${businessId}/tables`, { method: "POST", headers: auth, body: JSON.stringify({ name: `Table A ${suffix}` }) });
  const second = await request(`/businesses/${businessId}/tables`, { method: "POST", headers: auth, body: JSON.stringify({ name: `Table B ${suffix}` }) });
  const openPath = `/businesses/${businessId}/tables/${first.table.id}/dining-tabs`;
  const openAttempts = await Promise.allSettled([
    request(openPath, { method: "POST", headers: auth, body: JSON.stringify({}) }),
    request(openPath, { method: "POST", headers: auth, body: JSON.stringify({}) }),
  ]);
  assert.equal(openAttempts.filter((attempt) => attempt.status === "fulfilled").length, 1);
  assert.equal(openAttempts.filter((attempt) => attempt.status === "rejected" && /409/.test(attempt.reason.message)).length, 1);
  const opened = openAttempts.find((attempt) => attempt.status === "fulfilled").value;
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
  const registeredStaff = await request("/auth/register", { method: "POST", body: JSON.stringify({ email: `external-staff-${suffix}@example.test`, name: "External Staff", password: "SenhaSegura123" }) });
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

test("API rejects oversized fiscal documents before storage", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const registered = await request("/auth/register", {
    method: "POST", body: JSON.stringify({ email: `fiscal-${suffix}@example.test`, name: "Fiscal Owner", password: "SenhaSegura123" }),
  });
  const response = await fetch(`${base}/businesses/${registered.business.id}/fiscal/documents`, {
    method: "POST",
    headers: { Authorization: `Bearer ${registered.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ document_type: "nfce", payload: { data: "x".repeat(256 * 1024) } }),
  });
  assert.equal(response.status, 400);
});

test("API manages inventory movements and product recipes", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const registered = await request("/auth/register", {
    method: "POST", body: JSON.stringify({ email: `stock-${suffix}@example.test`, name: "Stock Owner", password: "SenhaSegura123" }),
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
  await assert.rejects(request(`/businesses/${businessId}/backups`, { headers: auth }), /403/);
  await assert.rejects(request(`/businesses/${businessId}/backups`, { method: "POST", headers: auth }), /403/);
  await assert.rejects(request(`/businesses/${businessId}/backups/restore`, { method: "POST", headers: auth, body: JSON.stringify({ name: "..\\outside.sql" }) }), /400/);
  await assert.rejects(request(`/businesses/${businessId}/backups/restore`, { method: "POST", headers: auth, body: JSON.stringify({ name: "food-system-2026-10-29T12-00-00-000Z.sql.enc" }) }), /403/);
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
