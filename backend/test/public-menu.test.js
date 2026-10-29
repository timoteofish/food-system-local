import test from "node:test";
import assert from "node:assert/strict";
import { createPublicMenu } from "../src/public-menu.js";

test("public menu exposes only approved display settings and a flat product list", () => {
  const menu = createPublicMenu({
    id: "business-1",
    name: "Cafe",
    description: "Breakfast",
    primary_color: "#112233",
    settings: JSON.stringify({
      gradient_start: "#223344",
      gradient_end: "#334455",
      gradient_angle: 75,
      menu_banner: "Welcome",
      delivery_fee: 0.29,
      show_all_products: false,
      selected_categories: ["Breakfast", "Hidden"],
      api_token: "private-token",
    }),
  }, [{
    id: "category-1",
    name: "Breakfast",
    products: [{ id: "product-1", name: "Toast", price: "5.50", image_url: "https://images.example/toast.jpg" }],
  }], { id: "table-1", name: "Table 1" });

  assert.equal(menu.business_id, "business-1");
  assert.equal(menu.business_name, "Cafe");
  assert.equal(menu.menu_name, "Breakfast");
  assert.equal(menu.gradient_start, "#223344");
  assert.equal(menu.gradient_angle, 75);
  assert.equal(menu.delivery_fee, 0.29);
  assert.deepEqual(menu.selected_categories, ["Breakfast"]);
  assert.equal(menu.products.length, 1);
  assert.equal(menu.products[0].category, "Breakfast");
  assert.equal(menu.products[0].price, 5.5);
  assert.equal(menu.table.name, "Table 1");
  assert.equal(Object.hasOwn(menu, "settings"), false);
  assert.equal(Object.hasOwn(menu, "api_token"), false);
});

test("public menu rejects unsafe colors and invalid settings values", () => {
  const menu = createPublicMenu({
    id: "business-2",
    name: "Cafe",
    primary_color: "url(javascript:alert(1))",
    settings: { gradient_start: "red; background:url(javascript:alert(1))", gradient_angle: 900, menu_banner: "x".repeat(700), delivery_fee: -1, selected_categories: [1, "Unknown"] },
  }, []);

  assert.equal(menu.primary_color, "#b4232f");
  assert.equal(menu.gradient_start, "#b4232f");
  assert.equal(menu.gradient_angle, 140);
  assert.equal(menu.menu_banner.length, 500);
  assert.equal(menu.delivery_fee, 0);
  assert.deepEqual(menu.selected_categories, []);
  assert.equal(menu.show_all_products, true);
});
