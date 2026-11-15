import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = (await readFile("../frontend/pages/courier/app.js", "utf8")).replace(/^import .*;\n/gm, "");
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const response = (data) => ({ ok: true, json: async () => data });
const flush = () => new Promise((resolve) => setImmediate(resolve));

const setup = (initialToken = "") => {
  const handlers = new Map();
  const elements = new Map();
  for (const id of ["courierToken", "tokenForm", "message", "deliveries", "clearToken", "sendLocation"]) {
    elements.set(id, { value: "", textContent: "", innerHTML: "", addEventListener: (type, fn) => handlers.set(`${id}:${type}`, fn) });
  }
  const values = new Map(initialToken ? [["food-system-courier-token", initialToken]] : []);
  const calls = [];
  let locationCallback;
  let timer;
  const window = { addEventListener: (type, fn) => handlers.set(`window:${type}`, fn), setInterval: (fn) => { timer = fn; }, prompt: () => "" };
  const document = { visibilityState: "visible", getElementById: (id) => elements.get(id), addEventListener: (type, fn) => handlers.set(`document:${type}`, fn) };
  const context = {
    API_BASE_URL: "/api", getLocale: () => "pt-BR", applyCourierTranslations() {}, translateCourier: (text) => text,
    document,
    window,
    AbortSignal,
    navigator: { geolocation: { getCurrentPosition: (success) => { locationCallback = success; } } },
    location: { protocol: "http:" },
    localStorage: { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) },
    fetch: (...args) => { const result = deferred(); calls.push({ args, ...result }); return result.promise; },
  };
  vm.runInNewContext(source, context);
  return { elements, handlers, calls, document, window, tick: () => timer(), getLocationCallback: () => locationCallback };
};

test("stale delivery results cannot restore information after logout or token change", async () => {
  const { elements, handlers, calls } = setup("old-token");
  handlers.get("clearToken:click")();
  calls[0].resolve(response({ courier: { name: "Old courier" }, deliveries: [{ id: "a", order_id: "a", status: "assigned", delivery_address: { street: "Private street" } }] }));
  await flush();
  assert.equal(elements.get("deliveries").innerHTML, "");
  assert.equal(elements.get("message").textContent, "Token removed from this device");

  elements.get("courierToken").value = "first";
  handlers.get("tokenForm:submit")({ preventDefault() {} });
  elements.get("courierToken").value = "second";
  handlers.get("tokenForm:submit")({ preventDefault() {} });
  calls[2].resolve(response({ courier: { name: "New courier" }, deliveries: [] }));
  await flush();
  calls[1].resolve(response({ courier: { name: "Old courier" }, deliveries: [] }));
  await flush();
  assert.equal(elements.get("message").textContent, "Courier: New courier");
});

test("location requested under an old session is not sent with a new token", async () => {
  const { elements, handlers, calls, getLocationCallback } = setup("old-token");
  handlers.get("sendLocation:click")();
  elements.get("courierToken").value = "new-token";
  handlers.get("tokenForm:submit")({ preventDefault() {} });
  await getLocationCallback()({ coords: { latitude: 1, longitude: 2, accuracy: 3 } });
  assert.equal(calls.length, 2);
  assert.equal(calls.some(({ args }) => args[0].endsWith("/courier/location")), false);
});

test("visible delivery screen refreshes cancelled work and stops polling after logout", async () => {
  const { elements, handlers, calls, document, tick } = setup("token");
  calls[0].resolve(response({ courier: { name: "Courier" }, deliveries: [{ id: "a", order_id: "a", status: "assigned", delivery_address: { street: "Street" } }] }));
  await flush();
  assert.match(elements.get("deliveries").innerHTML, /Street/);
  document.visibilityState = "hidden";
  tick();
  assert.equal(calls.length, 1);
  document.visibilityState = "visible";
  handlers.get("document:visibilitychange")();
  tick();
  assert.equal(calls.length, 2);
  calls[1].resolve(response({ courier: { name: "Courier" }, deliveries: [] }));
  await flush();
  assert.match(elements.get("deliveries").innerHTML, /No deliveries assigned/);
  handlers.get("clearToken:click")();
  tick();
  assert.equal(calls.length, 2);
});

test("a legacy or malformed address does not hide other deliveries", async () => {
  const { elements, calls } = setup("token");
  calls[0].resolve(response({ courier: { name: "Courier" }, deliveries: [
    { id: "a", order_id: "a", status: "assigned", delivery_address: "Rua antiga <script>" },
    { id: "b", order_id: "b", status: "assigned", delivery_address: "null" },
    { id: "c", order_id: "c", status: "assigned", delivery_address: JSON.stringify({ street: "Rua válida", number: "10", city: "Salvador" }) },
  ] }));
  await flush();
  const html = elements.get("deliveries").innerHTML;
  assert.match(html, /Rua antiga &lt;script&gt;/);
  assert.match(html, /Address not provided/);
  assert.match(html, /Rua válida/);
  assert.doesNotMatch(html, /<script>/);
  assert.equal(elements.get("message").textContent, "Courier: Courier");
});

test("courier reports a delivery issue with an optional bounded reason", async () => {
  const { elements, handlers, calls, window } = setup("token");
  calls[0].resolve(response({ courier: { name: "Courier" }, deliveries: [{ id: "a", order_id: "a", status: "assigned", delivery_address: {} }] }));
  await flush();
  assert.match(elements.get("deliveries").innerHTML, /data-status="failed"/);
  const button = { dataset: { id: "a", status: "failed" }, disabled: false };
  const event = { target: { closest: () => button } };
  window.prompt = () => null;
  await handlers.get("deliveries:click")(event);
  assert.equal(calls.length, 1);
  window.prompt = () => "x".repeat(501);
  await handlers.get("deliveries:click")(event);
  assert.equal(calls.length, 1);
  assert.match(elements.get("message").textContent, /500/);
  window.prompt = () => "  Address not found  ";
  const updating = handlers.get("deliveries:click")(event);
  assert.equal(calls.length, 2);
  assert.deepEqual(JSON.parse(calls[1].args[1].body), { status: "failed", failure_reason: "Address not found" });
  calls[1].resolve(response({ updated: true }));
  await flush();
  calls[2].resolve(response({ courier: { name: "Courier" }, deliveries: [] }));
  await updating;
  assert.match(elements.get("deliveries").innerHTML, /No deliveries assigned/);
});

test("an uncertain delivery update reloads the queue before warning the courier", async () => {
  const { elements, handlers, calls } = setup("token");
  calls[0].resolve(response({ courier: { name: "Courier" }, deliveries: [{ id: "a", order_id: "a", status: "assigned", delivery_address: {} }] }));
  await flush();
  const button = { dataset: { id: "a", status: "picked_up" }, disabled: false };
  const updating = handlers.get("deliveries:click")({ target: { closest: () => button } });
  calls[1].reject(new Error("connection lost"));
  await flush();
  assert.equal(calls.length, 3);
  calls[2].resolve(response({ courier: { name: "Courier" }, deliveries: [{ id: "a", order_id: "a", status: "picked_up", delivery_address: {} }] }));
  await updating;
  assert.match(elements.get("deliveries").innerHTML, /data-status="delivered"/);
  assert.match(elements.get("message").textContent, /Check the refreshed deliveries/);
});
