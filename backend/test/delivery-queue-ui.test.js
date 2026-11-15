import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

test("delivery queue exposes retry only when allowed and offers failure reporting", async () => {
  const source = await readFile("../frontend/pages/app/delivery/app.js", "utf8");
  const start = source.indexOf("const renderDeliveries =");
  const end = source.indexOf("const load =", start);
  assert.ok(start >= 0 && end > start);
  const list = { innerHTML: "", setAttribute() {} };
  const context = {
    deliveryList: list, couriers: [{ id: "active", name: "Active", active: 1 }, { id: "inactive", name: "Inactive", active: 0 }],
    statusLabels: { failed: "Delivery issue", assigned: "Waiting for pickup" },
    nextStatus: { assigned: { value: "picked_up", label: "Out for delivery" } },
    translate: (value) => value, escapeHtml: (value) => String(value).replaceAll("<", "&lt;").replaceAll(">", "&gt;"), formatAddress: () => "Address", renderEmpty: String,
  };
  vm.runInNewContext(source.slice(start, end) + "\nthis.render = renderDeliveries;", context);
  context.render([{ id: "failed", order_id: "order", status: "failed", can_retry: 1, failure_reason: "<unsafe>" }]);
  assert.match(list.innerHTML, /Assign another delivery attempt/);
  assert.match(list.innerHTML, /&lt;unsafe&gt;/);
  assert.match(list.innerHTML, /Active/);
  assert.doesNotMatch(list.innerHTML, /Inactive/);
  context.render([{ id: "failed", order_id: "order", status: "failed", can_retry: 0 }]);
  assert.doesNotMatch(list.innerHTML, /data-assign-delivery/);
  context.render([{ id: "assigned", order_id: "order", status: "assigned" }]);
  assert.match(list.innerHTML, /data-next-status="failed"/);
});

test("delivery issue prompt submits an optional reason and respects cancellation", async () => {
  const source = await readFile("../frontend/pages/app/delivery/app.js", "utf8");
  const start = source.indexOf('deliveryList.addEventListener("click"');
  const end = source.indexOf("const start =", start);
  assert.ok(start >= 0 && end > start);
  let click;
  let reason = "Address not found";
  const requests = [];
  const button = { disabled: false, dataset: { deliveryId: "delivery", nextStatus: "failed" } };
  const context = {
    deliveryList: { addEventListener: (_type, handler) => { click = handler; } },
    window: { prompt: () => reason }, translate: (value) => value,
    deliveryMessage: {}, setMessage() {}, businessId: "business", load: async () => {},
    apiRequest: async (path, options) => requests.push({ path, body: options.body }),
  };
  vm.runInNewContext(source.slice(start, end), context);
  const event = { target: { closest: (selector) => selector === "[data-delivery-id]" ? button : null } };
  await click(event);
  assert.equal(requests[0].body.failure_reason, "Address not found");
  reason = null;
  await click(event);
  assert.equal(requests.length, 1);
  reason = "x".repeat(501);
  await click(event);
  assert.equal(requests.length, 1);
});
