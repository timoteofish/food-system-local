import test from "node:test";
import assert from "node:assert/strict";
import { canTransitionOrderStatus } from "../src/order-status.js";

test("order status transitions allow forward workflow and cashier completion", () => {
  assert.equal(canTransitionOrderStatus("pending", "confirmed"), true);
  assert.equal(canTransitionOrderStatus("pending", "completed"), true);
  assert.equal(canTransitionOrderStatus("preparing", "out_for_delivery"), true);
  assert.equal(canTransitionOrderStatus("ready", "completed"), true);
  assert.equal(canTransitionOrderStatus("completed", "completed"), true);
});

test("completed and cancelled orders cannot be reopened or altered", () => {
  assert.equal(canTransitionOrderStatus("completed", "preparing"), false);
  assert.equal(canTransitionOrderStatus("completed", "cancelled"), false);
  assert.equal(canTransitionOrderStatus("cancelled", "completed"), false);
  assert.equal(canTransitionOrderStatus("cancelled", "pending"), false);
});
