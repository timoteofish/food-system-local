import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile("../frontend/pages/app/delivery/app.js", "utf8");
const start = source.indexOf('courierForm.addEventListener("submit"');
const end = source.indexOf('deliveryList.addEventListener("click"', start);
assert.ok(start >= 0 && end > start);
const registration = source.slice(start, end);
const urlStart = source.indexOf("const getCourierPublicUrl = async () => {");
const urlEnd = source.indexOf("const renderEmpty =", urlStart);
assert.ok(urlStart >= 0 && urlEnd > urlStart);
const urlHelper = source.slice(urlStart, urlEnd);

const setup = ({ failAt, publicUrl = "", origin = "http://localhost:4173" } = {}) => {
  const calls = [];
  const courierMessage = { textContent: "", type: "" };
  const button = { disabled: false };
  const form = { resetCalled: false, querySelector: () => button, reset() { this.resetCalled = true; } };
  let submit;
  let renew;
  const context = {
    businessId: "business", courierMessage, URL, courierAccessBusy: false,
    couriers: [{ id: "courier-id", name: "Driver", active: 1 }],
    window: { FOOD_SYSTEM_PUBLIC_MENU_URL: publicUrl, location: { origin }, confirm: () => true },
    translate: (message) => message,
    courierForm: { addEventListener: (_event, handler) => { submit = handler; } },
    courierList: { addEventListener: (_event, handler) => { renew = handler; } },
    document: { getElementById: (id) => ({ value: id === "courierName" ? "Driver" : "", focus() {} }) },
    setMessage: (element, message, type = "success") => { element.textContent = message; element.type = type; },
    apiRequest: async (url) => {
      calls.push(url);
      if (failAt === calls.length) throw new Error("unavailable");
      return url.endsWith("/token") ? { token: "private-token", expires_in_days: 30 } : { courier: { id: "courier-id" } };
    },
    load: async () => { calls.push("load"); },
  };
  vm.runInNewContext(urlHelper + registration, context);
  return { calls, courierMessage, button, form, submit: () => submit({ preventDefault() {}, currentTarget: form }), renew: () => renew({ target: { closest: () => ({ dataset: { renewCourier: "courier-id" }, disabled: false }) } }) };
};

test("registering a courier displays its new token once in the existing message", async () => {
  const page = setup();
  await page.submit();
  assert.deepEqual(page.calls, ["/businesses/business/couriers", "/businesses/business/couriers/courier-id/token", "load"]);
  assert.match(page.courierMessage.textContent, /private-token/);
  assert.match(page.courierMessage.textContent, /30/);
  assert.match(page.courierMessage.textContent, /Configure an HTTPS network address/);
  assert.equal(page.button.disabled, false);
  assert.equal(page.form.resetCalled, true);
});

test("a valid configured HTTPS origin is shown separately from the private token", async () => {
  const page = setup({ publicUrl: "https://restaurant.example:4173" });
  await page.submit();
  assert.match(page.courierMessage.textContent, /https:\/\/restaurant\.example:4173\/pages\/courier\/index\.html/);
  assert.doesNotMatch(page.courierMessage.textContent, /index\.html\?[^ ]*private-token/);
});

test("local, insecure, and malformed addresses do not become shareable links", async () => {
  for (const publicUrl of ["https://localhost:4173", "https://127.0.0.2", "https://[::1]", "http://restaurant.example", "https://user:pass@restaurant.example", "https://restaurant.example/path", "not a url"]) {
    const page = setup({ publicUrl });
    await page.submit();
    assert.match(page.courierMessage.textContent, /Configure an HTTPS network address/, publicUrl);
    assert.match(page.courierMessage.textContent, /private-token/, publicUrl);
  }
});

test("a remotely served HTTPS frontend can use its current origin", async () => {
  const page = setup({ origin: "https://restaurant.example" });
  await page.submit();
  assert.match(page.courierMessage.textContent, /https:\/\/restaurant\.example\/pages\/courier\/index\.html/);
});

test("token issuance failure does not pretend the courier registration failed", async () => {
  const page = setup({ failAt: 2 });
  await page.submit();
  assert.match(page.courierMessage.textContent, /Driver added but access token could not be issued/);
  assert.equal(page.courierMessage.type, "error");
  assert.equal(page.calls.at(-1), "load");
});

test("uncertain courier registration advises checking before retrying", async () => {
  const page = setup({ failAt: 1 });
  await page.submit();
  assert.match(page.courierMessage.textContent, /Check the list before trying again/);
  assert.equal(page.calls.length, 1);
});

test("an existing driver can receive a renewed token and address", async () => {
  const page = setup({ publicUrl: "https://restaurant.example" });
  await page.renew();
  assert.deepEqual(page.calls, ["/businesses/business/couriers/courier-id/token"]);
  assert.match(page.courierMessage.textContent, /Driver access renewed/);
  assert.match(page.courierMessage.textContent, /private-token/);
  assert.match(page.courierMessage.textContent, /https:\/\/restaurant\.example\/pages\/courier\/index\.html/);
});

test("uncertain renewal warns that the old token may have stopped working", async () => {
  const page = setup({ failAt: 1 });
  await page.renew();
  assert.match(page.courierMessage.textContent, /previous token may no longer work/);
  assert.equal(page.courierMessage.type, "error");
});
