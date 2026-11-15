import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

test("the verification panel requires a healthy API and database response", async () => {
  const source = await readFile("../frontend/shared/api/client.js", "utf8");
  const begin = source.indexOf("export const pingApi = async () => {");
  const end = source.indexOf("export const checkForUpdates", begin);
  assert.ok(begin >= 0 && end > begin);
  let response;
  const context = { API_BASE_URL: "http://127.0.0.1:3000/api/v1", AbortSignal, fetch: async () => response };
  vm.runInNewContext(source.slice(begin, end).replace("export const pingApi", "this.pingApi"), context);
  response = { ok: true, json: async () => ({ status: "ok", database: "ok" }) };
  assert.equal(await context.pingApi(), true);
  response = { ok: true, json: async () => ({ status: "ok", database: "unavailable" }) };
  assert.equal(await context.pingApi(), false);
  response = { ok: false, json: async () => ({ status: "error" }) };
  assert.equal(await context.pingApi(), false);
  response = { ok: true, json: async () => { throw new Error("invalid JSON"); } };
  assert.equal(await context.pingApi(), false);
});
