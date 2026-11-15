import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

test("product category and image survive loading and a status update", async () => {
  const source = await readFile("../frontend/pages/app/products/app.js", "utf8");
  const normalizerStart = source.indexOf("const normalizeProduct =");
  const normalizerEnd = source.indexOf("const list =", normalizerStart);
  const updateStart = source.indexOf("const updateProductStatus =");
  const updateEnd = source.indexOf("const render =", updateStart);
  assert.ok(normalizerStart >= 0 && normalizerEnd > normalizerStart && updateStart >= 0 && updateEnd > updateStart);
  const context = {
    toggleProductStatus: async () => ({ id: "product", name: "Meal", active: 0, image_url: "https://example.test/meal.png" }),
  };
  vm.runInNewContext(`
    let products = [];
    ${source.slice(normalizerStart, normalizerEnd)}
    ${source.slice(updateStart, updateEnd)}
    globalThis.load = (data) => { products = data.map(normalizeProduct); return products[0]; };
    globalThis.update = updateProductStatus;
  `, context);
  const loaded = context.load([{ id: "product", name: "Meal", category_name: "Lunch", image_url: "https://example.test/meal.png", active: 1 }]);
  assert.equal(loaded.category, "Lunch");
  assert.equal(loaded.image, "https://example.test/meal.png");
  const updated = await context.update("product");
  assert.equal(updated.active, 0);
  assert.equal(updated.category, "Lunch");
  assert.equal(updated.image, "https://example.test/meal.png");
});

test("category selection excludes deactivated categories", async () => {
  const source = await readFile("../frontend/shared/auth/auth.js", "utf8");
  const start = source.indexOf("export const loadCategories =");
  const end = source.indexOf("export const addCategoryRemote =", start);
  assert.ok(start >= 0 && end > start);
  const context = {
    requireBusinessId: () => "business",
    fetchCategories: async () => [
      { name: "Active", active: 1 },
      { name: "Inactive", active: 0 },
      { name: "Boolean inactive", active: false },
    ],
  };
  vm.runInNewContext(`${source.slice(start, end).replace("export const ", "const ")}\nglobalThis.load = loadCategories;`, context);
  assert.deepEqual(Array.from(await context.load()), ["Active"]);
});
