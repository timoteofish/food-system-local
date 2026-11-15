import test from "node:test";
import assert from "node:assert/strict";
import { beginRestore, endRestore, enterRequest, enterWork, isRestoreInProgress, leaveRequest, leaveWork, trackRouteWork } from "../src/maintenance.js";
import Fastify from "fastify";
import { request as httpRequest } from "node:http";

test("database restore waits for active requests and rejects new work", async () => {
  assert.equal(enterRequest(), true); // Restore request.
  assert.equal(enterRequest(), true); // Request already running when restore starts.

  const restore = beginRestore();
  assert.equal(isRestoreInProgress(), true);
  assert.equal(enterRequest(), false);
  assert.equal(await beginRestore(), false);

  leaveRequest();
  assert.equal(await restore, true);
  leaveRequest();
  endRestore();
  assert.equal(isRestoreInProgress(), false);
  assert.equal(enterRequest(), true);
  leaveRequest();
});

test("restore waits for a route that keeps running after its client disconnects", async () => {
  const app = Fastify();
  let unblock;
  let started;
  const running = new Promise((resolve) => { started = resolve; });
  const finish = new Promise((resolve) => { unblock = resolve; });
  app.addHook("onRoute", trackRouteWork);
  app.get("/api/v1/slow", async () => { started(); await finish; return { done: true }; });
  await app.listen({ host: "127.0.0.1", port: 0 });
  try {
    const address = app.server.address();
    const request = httpRequest({ hostname: "127.0.0.1", port: address.port, path: "/api/v1/slow" });
    request.on("error", () => {});
    request.end();
    await running;
    request.destroy();
    // Model the restore request's accounting after the disconnected request
    // has been released by the server's onRequestAbort hook.
    assert.equal(enterRequest(), true);
    enterWork();
    let drained = false;
    const restore = beginRestore().then((result) => { drained = true; return result; });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(drained, false);
    unblock();
    assert.equal(await restore, true);
    leaveWork();
    leaveRequest();
    endRestore();
  } finally {
    unblock();
    await app.close();
  }
});

test("restore waits for all in-flight handlers and rejects a disconnected late starter", async () => {
  const releases = [];
  const route = { url: "/api/v1/work", handler: async () => new Promise((resolve) => { releases.push(resolve); }) };
  trackRouteWork(route);
  const first = route.handler({}, {});
  const second = route.handler({}, {});
  assert.equal(enterRequest(), true);
  enterWork();
  let drained = false;
  const restore = beginRestore().then(() => { drained = true; });
  let status;
  let called = false;
  const late = { url: "/api/v1/late", handler: async () => { called = true; } };
  trackRouteWork(late);
  const reply = { code(value) { status = value; return this; }, send(value) { return value; } };
  await late.handler({}, reply);
  assert.equal(status, 503);
  assert.equal(called, false);
  releases[0]();
  await first;
  await Promise.resolve();
  assert.equal(drained, false);
  releases[1]();
  await second;
  await restore;
  assert.equal(drained, true);
  leaveWork();
  leaveRequest();
  endRestore();
});
