import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

test("profile save sends profile fields and reports failure before local changes", async () => {
  const source = await readFile("../frontend/shared/ui/ui.js", "utf8");
  const start = source.indexOf('  settingsForm?.addEventListener("submit"');
  const end = source.indexOf("  applyLegacyTranslations(panel);", start);
  assert.ok(start >= 0 && end > start);
  let handler;
  let apiOnline = true;
  let failSave = false;
  const requests = [];
  const localWrites = [];
  const feedback = {};
  const context = {
    settingsForm: { addEventListener: (_event, callback) => { handler = callback; }, querySelector: () => ({ disabled: false }) },
    settingsFeedback: feedback,
    FormData: class { get(key) { return { name: "Owner", phone: "123", businessName: "New business" }[key]; } },
    session: { email: "owner@example.test" }, business: { name: "Previous", email: "owner@example.test" }, clientEmail: "owner@example.test", pendingAvatar: "",
    translate: (value) => value,
    bootstrapApi: async () => {},
    isUsingApi: () => apiOnline,
    saveBusinessProfileRemote: async (settings) => { requests.push({ ...settings }); if (failSave) throw new Error("Conflict"); },
    saveBusiness: (value) => localWrites.push(value),
    getMenuSettings: () => ({}), saveMenuSettings: () => {},
    setSession: () => {}, getSession: () => ({ email: "owner@example.test" }), syncPanelIdentity: () => {},
  };
  vm.runInNewContext(source.slice(start, end), context);
  apiOnline = false;
  await handler({ preventDefault() {} });
  assert.equal(localWrites.length, 0);
  assert.equal(requests.length, 0);
  assert.match(feedback.textContent, /API unavailable/);
  apiOnline = true;
  failSave = true;
  await handler({ preventDefault() {} });
  assert.equal(localWrites.length, 0);
  assert.equal(feedback.textContent, "Conflict");
  failSave = false;
  await handler({ preventDefault() {} });
  assert.deepEqual(requests.map((request) => Object.keys(request)), [["businessName", "phone", "avatar"], ["businessName", "phone", "avatar"]]);
  assert.equal(localWrites[0].name, "New business");
  assert.equal(feedback.textContent, "Settings saved");
});

test("startup loads restored profile fields and preserves unsaved legacy values", async () => {
  const source = await readFile("../frontend/shared/auth/auth.js", "utf8");
  const start = source.indexOf("export const checkApiAvailability =");
  const end = source.indexOf("export const isUsingApi =", start);
  assert.ok(start >= 0 && end > start);
  let profile = { id: "business", name: "Restored", profile_phone: "987", profile_avatar: "data:image/png;base64,YQ==" };
  let local = { phone: "old", avatar: "old-image" };
  const context = {
    isApiEnabled: () => true, pingApi: async () => true, LOCAL_MODE: true,
    ensureLocalSession: () => ({ businessId: "business" }), getBusiness: () => ({ ...local, name: "Old" }),
    provisionLocalBusiness: async () => profile,
    saveBusiness: (value) => { local = { ...local, ...value }; },
  };
  vm.runInNewContext(`let apiAvailable; ${source.slice(start, end).replace("export const ", "const ")}\nglobalThis.load = checkApiAvailability;`, context);
  await context.load();
  assert.equal(local.name, "Restored");
  assert.equal(local.phone, "987");
  assert.equal(local.avatar, "data:image/png;base64,YQ==");
  profile = { id: "business", name: "Older installation", profile_phone: null, profile_avatar: null };
  await context.load();
  assert.equal(local.phone, "987");
  assert.equal(local.avatar, "data:image/png;base64,YQ==");
  profile = { id: "business", name: "Cleared", profile_phone: "", profile_avatar: "" };
  await context.load();
  assert.equal(local.phone, "");
  assert.equal(local.avatar, "");
});
