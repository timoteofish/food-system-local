import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile("../frontend/pages/app/menu/app.js", "utf8");
const start = source.indexOf("const persistMenuSettings =");
const end = source.indexOf("const monthlyOrderLimitByPlan", start);
assert.ok(start >= 0 && end > start);
const implementation = source.slice(start, end);

test("menu autosaves keep their order and recover after a failed request", async () => {
  let finishFirst;
  const first = new Promise((resolve) => { finishFirst = resolve; });
  const calls = [];
  const context = {
    Promise,
    menuSaveRetry: { disabled: false, hidden: true },
    translate: (value) => value,
    setMenuSaveStatus: () => {},
    saveMenuSettingsRemote: async (settings) => {
      calls.push(settings.businessName);
      if (settings.businessName === "first") await first;
      if (settings.businessName === "failed") throw new Error("connection failed");
      return { settingsVersion: settings.businessName };
    },
  };
  vm.runInNewContext(`let pendingSettings; let saveSequence = 0; let saveQueue = Promise.resolve(); let menuSettingsVersion = null; let menuBusinessVersion = null; let menuSaveConflict = false; ${implementation}
    globalThis.startSave = (name, categories = []) => {
      pendingSettings = { businessName: name, selectedCategories: categories };
      return persistMenuSettings(++saveSequence);
    };`, context);
  const saveFirst = context.startSave("first");
  const saveSecond = context.startSave("second");
  await Promise.resolve();
  assert.deepEqual(calls, ["first"]);
  finishFirst();
  await Promise.all([saveFirst, saveSecond]);
  assert.deepEqual(calls, ["first", "second"]);
  await context.startSave("failed");
  assert.equal(context.menuSaveRetry.hidden, false);
  await context.startSave("retry");
  assert.deepEqual(calls, ["first", "second", "failed", "retry"]);
  assert.equal(context.menuSaveRetry.hidden, true);
});

test("partial menu updates preserve unspecified remote and local settings", async () => {
  const auth = await readFile("../frontend/shared/auth/auth.js", "utf8");
  const from = auth.indexOf("export const saveMenuSettingsRemote =");
  const to = auth.indexOf("export const saveBusinessProfileRemote =", from);
  assert.ok(from >= 0 && to > from);
  const save = auth.slice(from, to)
    .replace("export const ", "const ")
    .replace('const { getMenuSettings, saveMenuSettings } = await import("../data/storage.js");', "const { getMenuSettings, saveMenuSettings } = storage;");
  let remote = { currency: "BRL", show_all_products: false, selected_categories: ["Meals"], menu_banner: "Welcome", delivery_fee: 5 };
  let local = { businessName: "Before", selectedCategories: ["Meals"], menuBanner: "Welcome" };
  const context = {
    isUsingApi: () => true,
    requireBusinessId: () => "business",
    fetchBusiness: async () => ({ settings: JSON.stringify(remote) }),
    updateBusiness: async (_id, fields) => { remote = fields.settings; },
    storage: { getMenuSettings: () => local, saveMenuSettings: (value) => { local = value; } },
  };
  vm.runInNewContext(`${save}\nglobalThis.save = saveMenuSettingsRemote;`, context);
  await context.save({ businessName: "After", menuName: "Menu" });
  assert.equal(remote.currency, "BRL");
  assert.equal(remote.show_all_products, false);
  assert.deepEqual(Array.from(remote.selected_categories), ["Meals"]);
  assert.equal(remote.menu_banner, "Welcome");
  assert.equal(remote.delivery_fee, 5);
  assert.equal(local.businessName, "After");
  assert.deepEqual(Array.from(local.selectedCategories), ["Meals"]);
  await context.save({ selectedCategories: [], showAllProducts: true, menuBanner: "", deliveryFee: 0 });
  assert.deepEqual(Array.from(remote.selected_categories), []);
  assert.equal(remote.show_all_products, true);
  assert.equal(remote.menu_banner, "");
  assert.equal(remote.delivery_fee, 0);
});

test("a conflict blocks queued stale menu saves until reload", async () => {
  const calls = [];
  const context = {
    Promise,
    menuSaveRetry: { disabled: false, hidden: true },
    translate: (value) => value,
    setMenuSaveStatus: () => {},
    saveMenuSettingsRemote: async (settings) => {
      calls.push(settings.businessName);
      const error = new Error("stale");
      error.status = 409;
      throw error;
    },
  };
  vm.runInNewContext(`let pendingSettings; let saveSequence = 0; let saveQueue = Promise.resolve(); let menuSettingsVersion = "original"; let menuBusinessVersion = null; let menuSaveConflict = false; ${implementation}
    globalThis.startSave = (name) => { pendingSettings = { businessName: name, selectedCategories: [] }; return persistMenuSettings(++saveSequence); };`, context);
  await Promise.all([context.startSave("first"), context.startSave("second")]);
  assert.deepEqual(calls, ["first"]);
  assert.equal(context.menuSaveRetry.hidden, false);
  assert.equal(context.menuSaveRetry.textContent, "menuReloadLabel");
});
