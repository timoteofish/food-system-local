import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { parseInventoryQuantity } from "../../frontend/shared/utils/utils.js";

const source = await readFile("../frontend/pages/app/inventory/app.js", "utf8");
const start = source.indexOf("const enterStockCount =");
const end = source.indexOf('document.getElementById("stockCountForm").addEventListener', start);
assert.ok(start >= 0 && end > start);
const action = source.slice(start, end);

const runCount = async (input) => {
  const calls = [];
  const context = {
    businessId: "business", activeStockCountId: null, parseInventoryQuantity,
    translate: (value) => value, formatNumber: String, formatInventoryUnit: String,
    window: { prompt: () => input },
    document: { getElementById: () => ({ dataset: {} }) },
    apiRequest: async (url, options) => {
      calls.push({ url, options });
      return options ? {} : { stock_count: { items: [{ inventory_item_id: "item", name: "Ingredient", unit: "kg", expected_quantity: 2 }] } };
    },
  };
  vm.runInNewContext(`${action}\nglobalThis.run = enterStockCount;`, context);
  return { calls, run: () => context.run("count") };
};

test("an empty stock count is not submitted while an explicit zero is accepted", async () => {
  const empty = await runCount(" ");
  await assert.rejects(empty.run(), /inventoryCountInvalid/);
  assert.equal(empty.calls.length, 1);
  const zero = await runCount("0");
  assert.equal(await zero.run(), true);
  assert.equal(zero.calls.length, 2);
  assert.equal(zero.calls[1].options.body.items[0].counted_quantity, 0);
});
