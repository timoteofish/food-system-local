import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (relative) => readFile(new URL(relative, root), "utf8");

test("polling routes keep per-store credentials local and encrypted", async () => {
  const routes = await read("src/routes/integration-polling.js");
  assert.match(routes, /put\("\/api\/v1\/businesses\/:businessId\/integrations\/:id\/polling-credentials"/);
  assert.match(routes, /get\("\/api\/v1\/businesses\/:businessId\/integrations\/:id\/polling-credentials"/);
  assert.match(routes, /delete\("\/api\/v1\/businesses\/:businessId\/integrations\/:id\/polling-credentials"/);
  assert.match(routes, /post\("\/api\/v1\/businesses\/:businessId\/integrations\/:id\/poll-now"/);
  assert.match(routes, /requireRole\(request, reply\)/);
  assert.match(routes, /encryptSecret\(serialized\)/);
  assert.match(routes, /integration:\$\{request\.params\.id\}:oauth/);
  assert.match(routes, /assertPublicHttpsUrl/);
  assert.match(routes, /resolvePublicHttpsAddress\(pollUrl\)/);
  assert.match(routes, /poll_enabled = true/);
  assert.match(routes, /has_token/);
  assert.doesNotMatch(routes, /host: "0\.0\.0\.0"|listen\(0\)/);
});

test("poller reuses the idempotent external-order boundary", async () => {
  const poller = await read("src/integration-poller.js");
  assert.match(poller, /requestPublicHttpsBody/);
  assert.match(poller, /normalizeOpenDeliveryOrder/);
  assert.match(poller, /integration_events/);
  assert.match(poller, /external_orders/);
  assert.match(poller, /WHERE integration_connection_id = \? AND external_order_id = \?/);
  assert.match(poller, /startPollingLoop/);
  assert.match(poller, /last_error/);
});

test("outbound helper keeps returning status for existing callers", async () => {
  const helper = await read("src/outbound-request.js");
  assert.match(helper, /export const requestPublicHttps = async \(url, options = \{\}\) =>\s+\(await requestPublicHttpsResult\(url, options\)\)\.status/);
  assert.match(helper, /export const requestPublicHttpsBody/);
  assert.match(helper, /resolvePublicHttpsAddress/);
});

test("server registers the polling route plugin", async () => {
  const server = await read("src/server.js");
  assert.match(server, /import integrationPollingRoutes from "\.\/routes\/integration-polling\.js"/);
  assert.match(server, /await app\.register\(integrationPollingRoutes\)/);
});
