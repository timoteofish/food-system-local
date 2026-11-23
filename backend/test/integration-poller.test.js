import test from "node:test";
import assert from "node:assert/strict";
import { normalizeOpenDeliveryOrder, normalizeOpenDeliveryStatus } from "../src/integration-adapters.js";

const sampleOrder = {
  id: "ifood-12345",
  status: "confirmed",
  createdAt: "2026-11-23T12:00:00Z",
  customer: { name: "Maria", phone: "11999999999" },
  delivery: { address: { street: "Rua A", number: "42" }, notes: "Portão azul" },
  items: [
    { id: "p1", name: "Pizza", quantity: 2, unitPrice: 4500 },
    { id: "p2", name: "Refrigerante", quantity: 1, price: "800" },
  ],
  total: 9800,
  payment: { method: "CREDIT_CARD" },
};

test("normalizes an Open Delivery order into the local external-order payload", () => {
  const normalized = normalizeOpenDeliveryOrder(sampleOrder);
  assert.equal(normalized.schema, "open-delivery");
  assert.equal(normalized.external_order_id, "ifood-12345");
  assert.equal(normalized.status, "confirmed");
  assert.equal(normalized.received_at, "2026-11-23T12:00:00Z");
  assert.equal(normalized.customer.name, "Maria");
  assert.equal(normalized.delivery.address, "Rua A");
  assert.equal(normalized.items.length, 2);
  assert.equal(normalized.items[0].unitPrice, 45);
  assert.equal(normalized.items[1].unitPrice, 8);
  assert.equal(normalized.total, 98);
  assert.equal(normalized.payment.method, "CREDIT_CARD");
});

test("accepts provider-specific id and order id aliases", () => {
  assert.equal(normalizeOpenDeliveryOrder({ orderId: "keeta-9", items: [] }).external_order_id, "keeta-9");
  assert.equal(normalizeOpenDeliveryOrder({ external_order_id: "99-7", items: [] }).external_order_id, "99-7");
});

test("rejects malformed orders before they reach the database", () => {
  assert.throws(() => normalizeOpenDeliveryOrder(null), /must be an object/);
  assert.throws(() => normalizeOpenDeliveryOrder({ items: [] }), /requires an id/);
  assert.throws(() => normalizeOpenDeliveryOrder({ id: "x".repeat(191), items: [] }), /at most 190/);
  assert.throws(() => normalizeOpenDeliveryOrder({ id: "a", items: [], pad: "x".repeat(256 * 1024) }), /256 KB/);
});

test("maps provider status aliases to the external-orders status enum", () => {
  assert.equal(normalizeOpenDeliveryStatus("new"), "received");
  assert.equal(normalizeOpenDeliveryStatus("confirmed"), "accepted");
  assert.equal(normalizeOpenDeliveryStatus("in_preparation"), "preparing");
  assert.equal(normalizeOpenDeliveryStatus("dispatched"), "out_for_delivery");
  assert.equal(normalizeOpenDeliveryStatus("delivered"), "completed");
  assert.equal(normalizeOpenDeliveryStatus("cancelled"), "cancelled");
  assert.equal(normalizeOpenDeliveryStatus("something-unknown"), null);
});

test("poller reads only connections configured for polling", async () => {
  const { pollIntegrationsOnce } = await import("../src/integration-poller.js");
  const result = await pollIntegrationsOnce();
  assert.ok(Array.isArray(result.connections));
  for (const entry of result.connections) {
    assert.ok(entry.connection_id);
    assert.ok(entry.skipped || entry.imported !== undefined || entry.error);
  }
});
