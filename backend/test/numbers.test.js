import test from "node:test";
import assert from "node:assert/strict";
import { hasDecimalScale, toMinorUnits } from "../src/numbers.js";

test("database decimal scales reject values that MariaDB would round", () => {
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
