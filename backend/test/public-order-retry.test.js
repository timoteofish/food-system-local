import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import vm from "node:vm";

const source = await readFile("../frontend/pages/qr-code-final/app.js", "utf8");
const extract = (start, end) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from);
  return source.slice(from, to);
};
const setup = (values, requested, confirmation, crypto = webcrypto, onPlace = () => {}, overrides = {}) => {
  let click;
  let quantity = 1;
  const storage = { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
  const elements = {
    bagConfirm: { addEventListener: (_type, handler) => { click = handler; } },
    orderType: { value: "counter" }, customerName: { value: "Customer" }, paymentMethod: { value: "pix" },
    deliveryStreet: { value: "" }, deliveryNumber: { value: "" }, deliveryCity: { value: "" },
  };
  const context = {
    sessionStorage: storage, crypto, TextEncoder, Uint8Array, elements, window: { confirm: confirmation },
    getCartEntries: () => [{ product: { id: "product" }, quantity }], getCartTotal: () => 10,
    publicBusinessId: "business", settings: { deliveryFee: 0 }, tableToken: "", currentTableName: "Table",
    translate: (value) => value, showToast() {}, renderBagPanel() {}, cart: { product: 1 },
    placeCustomerOrder: async (order) => { requested.push(order.idempotencyKey); const accepted = onPlace(order); if (accepted) return accepted; throw new Error("Connection lost"); },
    ...overrides,
  };
  const state = extract('const idempotencyStorageKey =', 'const cart =');
  const handler = extract('elements.bagConfirm?.addEventListener("click"', 'document.addEventListener("keydown"');
  vm.runInNewContext(state + handler, context);
  return { click: () => click(), setQuantity: (value) => { quantity = value; }, elements };
};

test("uncertain public orders reuse their key after reload and warn before a changed order", async () => {
  const values = new Map();
  const requested = [];
  let confirmations = 0;
  const confirmation = () => { confirmations += 1; return false; };
  const first = setup(values, requested, confirmation);
  await first.click();
  assert.equal(requested.length, 1);
  assert.doesNotMatch([...values.values()][0], /Customer/);
  const reopened = setup(values, requested, confirmation);
  await reopened.click();
  assert.equal(requested[1], requested[0]);
  reopened.setQuantity(2);
  await reopened.click();
  assert.equal(confirmations, 1);
  assert.equal(requested.length, 2);
});

test("a cart storage failure after acceptance retains the retry key and reports success", async () => {
  const values = new Map();
  const requested = [];
  const messages = [];
  const page = setup(values, requested, () => true, webcrypto, () => ({ id: "accepted" }), {
    clearCart: () => { throw new Error("Storage blocked"); },
    showToast: (message) => messages.push(message),
  });
  await page.click();
  assert.equal(requested.length, 1);
  assert.match(messages[0], /Order received/);
  assert.ok([...values.values()][0].includes(requested[0]));
  const reopened = setup(values, requested, () => true);
  await reopened.click();
  assert.equal(requested[1], requested[0]);
});

test("delivery details are captured before asynchronous submission", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const crypto = { randomUUID: () => webcrypto.randomUUID(), subtle: { digest: async (...args) => { await gate; return webcrypto.subtle.digest(...args); } } };
  let sent;
  const page = setup(new Map(), [], () => true, crypto, (order) => { sent = order; });
  page.elements.orderType.value = "delivery";
  page.elements.deliveryStreet.value = "First street";
  page.elements.deliveryNumber.value = "12";
  page.elements.deliveryCity.value = "City";
  const pending = page.click();
  page.elements.orderType.value = "counter";
  page.elements.deliveryStreet.value = "Other street";
  release();
  await pending;
  assert.equal(sent.delivery.address.street, "First street");
  assert.equal(sent.delivery.address.number, "12");
  assert.equal(sent.delivery.address.city, "City");
});

test("multiple clicks before signature calculation send only one request", async () => {
  const values = new Map();
  const requested = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const delayedCrypto = {
    randomUUID: () => webcrypto.randomUUID(),
    subtle: { digest: async (...args) => { await gate; return webcrypto.subtle.digest(...args); } },
  };
  const page = setup(values, requested, () => true, delayedCrypto);
  const first = page.click();
  const second = page.click();
  release();
  await Promise.all([first, second]);
  assert.equal(requested.length, 1);
  await page.click();
  assert.equal(requested.length, 2);
  assert.equal(requested[0], requested[1]);
});
