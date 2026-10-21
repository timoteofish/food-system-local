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
