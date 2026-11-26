import test from "node:test";
import assert from "node:assert/strict";
import {
  TERMINAL_PROVIDERS,
  GATEWAY_PROVIDERS,
  buildTerminalCharge,
  normalizeTerminalResponse,
  buildGatewayCheckout,
  normalizeGatewayCheckout,
  normalizeGatewayWebhook,
} from "../src/payment-adapters.js";

const charge = { amount: 42.5, installments: 3, orderId: "order-1", reference: "ref-1" };

test("terminal providers build an amount-based charge payload in cents", () => {
  for (const provider of TERMINAL_PROVIDERS) {
    const payload = buildTerminalCharge(provider, charge);
    assert.equal(payload.installments, 3);
    assert.equal(payload.order_id, "order-1");
    assert.equal(payload.reference, "ref-1");
    assert.ok(Object.values(payload).some((value) => value === 4250 || value === 42.5), `${provider} missing amount`);
  }
});

test("terminal charge caps installments and rejects invalid amounts", () => {
  assert.equal(buildTerminalCharge("generic", { ...charge, installments: 99 }).installments, 1);
  assert.throws(() => buildTerminalCharge("generic", { ...charge, amount: 0 }), /Invalid payment amount/);
});

test("terminal responses map approved, declined and unknown statuses", () => {
  assert.equal(normalizeTerminalResponse("stone", { status: "approved", transaction_id: "abc" }, 200).status, "approved");
  assert.equal(normalizeTerminalResponse("pagbank", { status: "recusado" }, 200).status, "declined");
  assert.equal(normalizeTerminalResponse("getnet", { status: "unknown" }, 500).status, "error");
  assert.equal(normalizeTerminalResponse("cielo", { status: "aprovado", tid: "tid-1" }, 200).external_id, "tid-1");
});

test("gateway providers build checkout payloads and normalize checkout URLs", () => {
  for (const provider of GATEWAY_PROVIDERS) {
    const payload = buildGatewayCheckout(provider, { amount: 10, orderId: "order-1", returnUrl: "https://shop.example/return", description: "Pedido" });
    assert.equal(payload.order_id, "order-1");
    assert.ok(Object.values(payload).some((value) => value === 1000 || value === 10), `${provider} missing amount`);
    const normalized = normalizeGatewayCheckout(provider, { id: "pay-1", checkout_url: "https://gateway.example/checkout/pay-1" }, 201);
    assert.equal(normalized.checkout_url, "https://gateway.example/checkout/pay-1");
    assert.equal(normalized.external_id, "pay-1");
  }
});

test("gateway checkout rejects a missing or unsafe redirect URL", () => {
  assert.throws(() => normalizeGatewayCheckout("stripe", { id: "pay-1" }, 200), /checkout URL/);
  assert.throws(() => normalizeGatewayCheckout("asaas", { link: "javascript:alert(1)" }, 200), /checkout URL/);
});

test("gateway webhooks map provider statuses to local statuses", () => {
  assert.equal(normalizeGatewayWebhook("mercadopago", { status: "approved", id: "pay-1" }).status, "approved");
  assert.equal(normalizeGatewayWebhook("asaas", { status: "declined" }).status, "declined");
  assert.equal(normalizeGatewayWebhook("stripe", { event: "payment.confirmed", id: "cs_1" }).status, "approved");
  assert.equal(normalizeGatewayWebhook("pagarme", { status: "refunded" }).status, "declined");
  assert.equal(normalizeGatewayWebhook("pagbank", { status: "pending" }).status, "pending");
});
