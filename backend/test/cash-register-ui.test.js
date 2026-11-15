import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { localizeSystemMessage } from "../../frontend/shared/i18n/system-messages.js";
import { webcrypto } from "node:crypto";

const source = await readFile("../frontend/pages/app/cashier/app.js", "utf8");
const start = source.indexOf('registerForm?.addEventListener("submit"');
const end = source.indexOf('movementForm?.addEventListener("submit"', start);
assert.ok(start >= 0 && end > start);

test("completed sales are not presented as confirmed payments", () => {
  assert.equal(localizeSystemMessage("Sale completed"), "Pedido concluído (pagamento não confirmado)");
  assert.equal(localizeSystemMessage("Venda concluída"), "Pedido concluído (pagamento não confirmado)");
});

test("closing a register displays recorded totals and their limitations", async () => {
  let submit;
  const messages = [];
  const context = {
    registerForm: { addEventListener: (_event, handler) => { submit = handler; } },
    registerBusy: false, registerAction: {}, registerMessage: {},
    registerAmount: { focus() {} }, registerNotes: { value: "" },
    currentRegister: { id: "register" }, businessId: "business", hasLoadedCash: true,
    normalizeMoneyInput: () => 15, formatPrice: (amount) => `R$ ${amount}`,
    translate: (key) => ({ cashConfirmClose: "Close $1?", cashRegisterClosedWithTotals: "Expected $1, difference $2; all methods, payment unconfirmed" })[key] || key,
    window: { confirm: () => true },
    setMessage: (_element, message) => { messages.push(message); },
    closeCashRegister: async () => ({ reconciliation: { expected_amount: 20, difference_amount: -5 } }),
    renderRegister() {}, refresh: async () => {},
  };
  vm.runInNewContext(source.slice(start, end), context);
  await submit({ preventDefault() {} });
  assert.equal(messages.at(-1), "Expected R$ 20, difference R$ -5; all methods, payment unconfirmed");
  assert.equal(context.currentRegister, null);
  assert.equal(context.registerAction.disabled, false);
});

test("an uncertain closing reloads the register and warns before retrying", async () => {
  let submit;
  let refreshed = false;
  const messages = [];
  const context = {
    registerForm: { addEventListener: (_event, handler) => { submit = handler; } },
    registerBusy: false, registerAction: {}, registerMessage: {}, registerAmount: {}, registerNotes: { value: "" },
    currentRegister: { id: "register" }, businessId: "business", hasLoadedCash: true,
    normalizeMoneyInput: () => 15, formatPrice: String, translate: (key) => key,
    window: { confirm: () => true }, setMessage: (_element, message) => messages.push(message),
    closeCashRegister: async () => { throw new Error("connection lost"); },
    refresh: async () => { refreshed = true; },
  };
  vm.runInNewContext(source.slice(start, end), context);
  await submit({ preventDefault() {} });
  assert.equal(refreshed, true);
  assert.equal(messages.at(-1), "cashRegisterOutcomeUncertain");
  assert.equal(context.registerAction.disabled, false);
});

test("a failed refresh disables operations and hides stale cash totals", async () => {
  const begin = source.indexOf("const refresh = async () => {");
  const finish = source.indexOf('loadRetry?.addEventListener("click"', begin);
  assert.ok(begin >= 0 && finish > begin);
  let alertShown = false;
  const context = {
    refreshInProgress: false, hasLoadedCash: true, pageLoading: {}, loadRetry: {},
    cashSummary: { setAttribute() {} }, log: { setAttribute() {}, innerHTML: "old data" },
    registerAction: {}, movementSubmit: {},
    registerStatus: { textContent: "open", classList: { remove() {} } },
    entriesTotal: { textContent: "old" }, exitsTotal: { textContent: "old" }, balanceTotal: { textContent: "old" },
    businessId: "business", translate: (key) => key,
    fetchCurrentCashRegister: async () => { throw new Error("offline"); },
    showLoadAlert: () => { alertShown = true; },
  };
  vm.runInNewContext(source.slice(begin, finish) + "\nthis.runRefresh = refresh;", context);
  await context.runRefresh();
  assert.equal(context.hasLoadedCash, false);
  assert.equal(context.registerAction.disabled, true);
  assert.equal(context.movementSubmit.disabled, true);
  assert.equal(context.registerStatus.textContent, "cashDataUnavailable");
  assert.equal(context.balanceTotal.textContent, "—");
  assert.match(context.log.innerHTML, /cashDataUnavailable/);
  assert.equal(alertShown, true);
});

test("an uncertain cash movement reloads history and warns about duplicates", async () => {
  const begin = source.indexOf('movementForm?.addEventListener("submit"');
  const finish = source.indexOf('log?.addEventListener("click"', begin);
  assert.ok(begin >= 0 && finish > begin);
  let submit;
  let refreshed = false;
  const messages = [];
  const fields = { movementAmount: { value: "10" }, movementType: { value: "entry" }, movementDescription: { value: "Change" } };
  const context = {
    movementForm: { addEventListener: (_event, handler) => { submit = handler; } },
    movementBusy: false, currentRegister: { id: "register" }, hasLoadedCash: true,
    movementSubmit: {}, movementMessage: {}, businessId: "business",
    document: { getElementById: (id) => fields[id] },
    normalizeMoneyInput: () => 10, translate: (key) => key,
    cashMovementSignature: async () => "signature", pendingCashMovement: null,
    sessionStorage: { setItem() {} }, cashMovementStorageKey: "key", crypto: webcrypto,
    setMessage: (_element, message) => messages.push(message),
    createCashMovement: async () => { throw new Error("connection lost"); },
    refresh: async () => { refreshed = true; },
  };
  vm.runInNewContext(source.slice(begin, finish), context);
  await submit({ preventDefault() {}, target: { reset() { throw new Error("must retain details"); } } });
  assert.equal(refreshed, true);
  assert.equal(messages.at(-1), "cashMovementOutcomeUncertain");
  assert.equal(context.movementSubmit.disabled, false);
});

test("cashier queue filters by order status without inferring payment confirmation", () => {
  const begin = source.indexOf("const getPendingCounterPayments =");
  const finish = source.indexOf("const renderSummary =", begin);
  assert.ok(begin >= 0 && finish > begin);
  const context = {
    PAYMENT_METHODS: { CASH_AT_COUNTER: "cash_at_counter" },
    orders: ["pending", "ready", "completed", "cancelled", "unknown"].map((status) => ({ id: status, orderStatus: status, paymentMethod: "cash_at_counter" })),
  };
  vm.runInNewContext(source.slice(begin, finish) + "\nthis.pending = getPendingCounterPayments();", context);
  assert.deepEqual(Array.from(context.pending, (order) => order.id), ["pending", "ready"]);
});

test("uncertain movement retries reuse the key after reload and changed details require confirmation", async () => {
  const begin = source.indexOf('movementForm?.addEventListener("submit"');
  const finish = source.indexOf('log?.addEventListener("click"', begin);
  const stateBegin = source.indexOf("const cashMovementStorageKey =");
  const stateEnd = source.indexOf("const normalizeMoneyInput =", stateBegin);
  assert.ok(stateBegin >= 0 && stateEnd > stateBegin);
  const saved = new Map();
  const attempts = [];
  const storage = { getItem: (key) => saved.get(key) || null, setItem: (key, value) => saved.set(key, value), removeItem: (key) => saved.delete(key) };
  let confirmationCount = 0;
  const setup = () => {
    let submit;
    const fields = { movementAmount: { value: "10" }, movementType: { value: "entry" }, movementDescription: { value: "Private description" } };
    const context = {
      movementForm: { addEventListener: (_event, handler) => { submit = handler; } },
      movementBusy: false, currentRegister: { id: "register" }, hasLoadedCash: true,
      movementSubmit: {}, movementMessage: {}, businessId: "business", sessionStorage: storage,
      document: { getElementById: (id) => fields[id] }, crypto: webcrypto, TextEncoder, Uint8Array,
      normalizeMoneyInput: () => 10, translate: (key) => key, setMessage() {},
      window: { confirm: () => { confirmationCount += 1; return false; } },
      createCashMovement: async (_business, _movement, key) => { attempts.push(key); throw new Error("connection lost"); },
      refresh: async () => {},
    };
    vm.runInNewContext(source.slice(stateBegin, stateEnd) + source.slice(begin, finish), context);
    return { fields, submit: () => submit({ preventDefault() {}, target: { reset() {} } }) };
  };
  await setup().submit();
  assert.doesNotMatch([...saved.values()][0], /Private description/);
  const reloaded = setup();
  await reloaded.submit();
  assert.equal(attempts[0], attempts[1]);
  reloaded.fields.movementDescription.value = "Different";
  await reloaded.submit();
  assert.equal(attempts.length, 2);
  assert.equal(confirmationCount, 1);
});
