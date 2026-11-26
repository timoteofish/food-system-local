import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import sensible from "@fastify/sensible";
import { createHmac } from "node:crypto";

process.env.FOOD_SYSTEM_SECRET_KEY ||= "0123456789abcdef0123456789abcdef";
const { pool } = await import("../src/db.js");
const { default: paymentRoutes } = await import("../src/routes/payments.js");

const business = "00000000-0000-4000-8000-000000000001";
const headers = { "x-food-system-local": "true" };

const seed = async () => {
  await pool.query("INSERT INTO businesses(id,name,settings) VALUES(?,?,?)", [business, "Payments", "{}"]).catch(() => {});
  await pool.query("INSERT OR IGNORE INTO payment_methods(id,business_id,name) VALUES(?,?,?)", ["pm-card", business, "Cartão"]).catch(() => {});
  await pool.query("INSERT OR IGNORE INTO orders(id,business_id,total) VALUES(?,?,?)", ["order-pay", business, 42.5]).catch(() => {});
};

test("local terminal charge is persisted and linked to the order", { timeout: 15000 }, async () => {
  await seed();
  const terminal = Fastify();
  terminal.post("/pay", async (request) => ({ status: "approved", transaction_id: "NSU-123", amount_cents: request.body.amount_cents }));
  await terminal.listen({ port: 0, host: "127.0.0.1" });
  const endpoint = `http://127.0.0.1:${terminal.server.address().port}/pay`;

  const app = Fastify();
  try {
    await app.register(sensible);
    await app.register(paymentRoutes);
    const created = await app.inject({ method: "POST", url: `/api/v1/businesses/${business}/payment-terminals`, headers, payload: { provider: "generic", display_name: "Caixa 1", endpoint_url: endpoint, access_token: "token12345" } });
    assert.equal(created.statusCode, 201);
    const terminalId = created.json().terminal.id;

    const listed = await app.inject({ method: "GET", url: `/api/v1/businesses/${business}/payment-terminals`, headers });
    assert.equal(listed.statusCode, 200);
    assert.equal(listed.json().terminals.length, 1);

    const charged = await app.inject({ method: "POST", url: `/api/v1/businesses/${business}/payment-terminals/${terminalId}/charge`, headers, payload: { order_id: "order-pay", amount: 42.5, installments: 2, payment_allocation: { payment_method_id: "pm-card", amount: 42.5 } } });
    assert.equal(charged.statusCode, 201);
    assert.equal(charged.json().payment.status, "approved");
    assert.equal(charged.json().payment.external_id, "NSU-123");

    const payments = await app.inject({ method: "GET", url: `/api/v1/businesses/${business}/card-payments`, headers });
    assert.equal(payments.json().payments.length, 1);
    const [allocations] = await pool.query("SELECT card_payment_id FROM order_payments WHERE order_id = ?", ["order-pay"]);
    assert.equal(allocations.length, 1);
    assert.ok(allocations[0].card_payment_id);
  } finally {
    await app.close();
    await terminal.close();
  }
});

test("terminal endpoints reject public HTTP addresses", { timeout: 15000 }, async () => {
  await seed();
  const app = Fastify();
  try {
    await app.register(sensible);
    await app.register(paymentRoutes);
    const rejected = await app.inject({ method: "POST", url: `/api/v1/businesses/${business}/payment-terminals`, headers, payload: { provider: "stone", display_name: "Remoto", endpoint_url: "http://example.com/pay", access_token: "token12345" } });
    assert.equal(rejected.statusCode, 400);
  } finally {
    await app.close();
  }
});

test("gateway webhook requires a valid HMAC signature", { timeout: 15000 }, async () => {
  await seed();
  const app = Fastify();
  try {
    await app.register(sensible);
    await app.register(paymentRoutes);
    const created = await app.inject({ method: "POST", url: `/api/v1/businesses/${business}/payment-gateways`, headers, payload: { provider: "asaas", display_name: "Asaas", api_url: "https://api.example.com/v1", access_token: "token12345", webhook_secret: "webhook-secret-123456" } });
    assert.equal(created.statusCode, 201);
    const gatewayId = created.json().gateway.id;
    const payload = { status: "approved", id: "pay-ext-1" };
    const body = JSON.stringify(payload);
    const signature = `sha256=${createHmac("sha256", "webhook-secret-123456").update(body).digest("hex")}`;
    const rejected = await app.inject({ method: "POST", url: `/api/v1/businesses/${business}/payment-gateways/${gatewayId}/webhook`, payload, headers: { "x-payment-signature": "sha256=bad" } });
    assert.equal(rejected.statusCode, 401);
    const accepted = await app.inject({ method: "POST", url: `/api/v1/businesses/${business}/payment-gateways/${gatewayId}/webhook`, payload, headers: { "x-payment-signature": signature } });
    assert.equal(accepted.statusCode, 200);
    assert.equal(accepted.json().updated, 0);
  } finally {
    await app.close();
  }
});
