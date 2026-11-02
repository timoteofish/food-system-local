import test from "node:test";
import assert from "node:assert/strict";
import { hydrateOrders } from "../src/order-hydration.js";

test("order hydration batches items and payments instead of querying each order", async () => {
  const orders = Array.from({ length: 251 }, (_, index) => ({ id: `order-${index}`, status: "pending" }));
  const calls = [];
  const query = async (sql, ids) => {
    calls.push({ sql, ids });
    if (sql.includes("FROM order_items")) {
      return [ids.map((order_id) => ({ order_id, name: `item for ${order_id}` })), []];
    }
    return [ids.map((order_id) => ({ order_id, payment_method_name: `method for ${order_id}` })), []];
  };

  const hydrated = await hydrateOrders(orders, query);

  assert.equal(calls.length, 4);
  assert.deepEqual(calls.map(({ ids }) => ids.length), [250, 250, 1, 1]);
  assert.deepEqual(hydrated[0].items, [{ order_id: "order-0", name: "item for order-0" }]);
  assert.deepEqual(hydrated[0].payments, [{ order_id: "order-0", payment_method_name: "method for order-0" }]);
  assert.deepEqual(hydrated[250].items, [{ order_id: "order-250", name: "item for order-250" }]);
  assert.deepEqual(hydrated[250].payments, [{ order_id: "order-250", payment_method_name: "method for order-250" }]);
  assert.deepEqual(hydrated.map(({ id }) => id), orders.map(({ id }) => id));
  assert.equal(orders[0].items, undefined);
});

test("order hydration avoids detail queries for an empty order list", async () => {
  let queryCount = 0;
  const orders = [];

  const hydrated = await hydrateOrders(orders, async () => {
    queryCount += 1;
    return [[], []];
  });

  assert.equal(hydrated, orders);
  assert.equal(queryCount, 0);
});
