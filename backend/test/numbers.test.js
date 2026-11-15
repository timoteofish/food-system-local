import test from "node:test";
import assert from "node:assert/strict";
import { discountCents, hasDecimalScale, orderLineCents, purchaseLineCents, reverseWeightedStockCost, stockDemandMicroUnits, stockDemandQuantity, toMinorUnits, weightedStockCost } from "../src/numbers.js";
import { hasQuantityPrecision, orderLineCents as frontendOrderLineCents, parseInventoryQuantity } from "../../frontend/shared/utils/utils.js";

test("database decimal scales reject values beyond the supported precision", () => {
  assert.equal(hasDecimalScale("12.30", 2), true);
  assert.equal(hasDecimalScale(1e-3, 3), true);
  assert.equal(hasDecimalScale("1.005", 2), false);
  assert.equal(hasDecimalScale("1.2345", 3), false);
  assert.equal(hasDecimalScale("0x10", 2), false);
  assert.equal(hasDecimalScale("1e3", 2), false);
  assert.equal(hasDecimalScale("+1.00", 2), false);
  assert.equal(hasDecimalScale(true, 2), false);
  assert.equal(hasDecimalScale("not-a-number", 2), false);
  assert.equal(hasDecimalScale("", 2), false);
});

test("minor-unit conversion supports exact payment reconciliation", () => {
  assert.equal(toMinorUnits("12.34"), 1234);
  assert.equal(toMinorUnits(0.01) + toMinorUnits(0.02), toMinorUnits(0.03));
});

test("fractional order amounts and discounts round consistently in cents", () => {
  assert.equal(orderLineCents(0.10, 0.15), 2);
  assert.equal(orderLineCents(0.30, 0.15), 5);
  assert.equal(discountCents(5, "percentage", 10), 1);
  assert.equal(discountCents(5, "fixed", 1), 5);
  assert.equal(orderLineCents(99_999_999.99, 999), 9_989_999_999_001);
});

test("frontend accepts valid fractional stock and matches backend order rounding", () => {
  for (const quantity of [1.001, 1.005, 1.009, 4.001]) assert.equal(hasQuantityPrecision(quantity), true);
  for (const quantity of [1.0001, Infinity, NaN]) assert.equal(hasQuantityPrecision(quantity), false);
  for (const [price, quantity] of [[0.10, 0.15], [0.30, 0.15], [4.99, 3], [999.99, 998.99]]) {
    assert.equal(frontendOrderLineCents(price, quantity), orderLineCents(price, quantity));
  }
});

test("inventory quantity entry distinguishes an empty input from an explicit zero", () => {
  for (const text of ["", "  ", "1e3", "0x10", "-1", "1,0001"]) assert.equal(parseInventoryQuantity(text), null);
  assert.equal(parseInventoryQuantity("0"), 0);
  assert.equal(parseInventoryQuantity(" 1,001 "), 1.001);
  assert.equal(parseInventoryQuantity("1,0010"), 1.001);
  assert.equal(parseInventoryQuantity(".5"), 0.5);
});

test("stock requirements aggregate before rounding and reject unrepresentable quantities", () => {
  const half = stockDemandMicroUnits(0.001, 0.5);
  assert.equal(stockDemandQuantity(half + half), 0.001);
  assert.throws(() => stockDemandQuantity(stockDemandMicroUnits(0.001, 0.01)), /below supported stock precision/);
  assert.throws(() => stockDemandQuantity(stockDemandMicroUnits(999_999_999.999, 999)), /exceeds supported stock quantity/);
});

test("fractional purchase totals use exact intermediate values", () => {
  assert.equal(purchaseLineCents(0.15, 0.1), 2n);
  assert.equal(purchaseLineCents(0.15, 0.3), 5n);
  assert.equal(purchaseLineCents(999_999_999.999, 99_999_999.9999), 9_999_999_999_980_000_000n);
});

test("weighted inventory cost rounds half up without losing precision", () => {
  assert.equal(weightedStockCost(0.001, 0.0001, 0.001, 0.0006), 0.0004);
  assert.equal(weightedStockCost(0, 10, 0.001, 0.0006), 0.0006);
  assert.equal(weightedStockCost(2, 3.1234, 0, 50), 3.1234);
});

test("reversing weighted cost uses exact scaled quantities and rounds half up", () => {
  assert.equal(reverseWeightedStockCost(0.001, 0.0004, 0.001, 0.0006), 0.0002);
  assert.equal(reverseWeightedStockCost(2, 4, 1, 3), 4.5);
  assert.equal(reverseWeightedStockCost(0, 4, 1, 3), 0);
  assert.equal(reverseWeightedStockCost(0.001, 0.0001, 1, 99), 0);
});
