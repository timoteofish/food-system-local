export const hasDecimalScale = (value, scale) => {
  if ((typeof value !== "number" && typeof value !== "string") || !String(value).trim()) return false;
  if (typeof value === "string" && !/^-?\d+(?:\.\d+)?$/.test(value.trim())) return false;
  const number = Number(value);
  return Number.isFinite(number) && Number(number.toFixed(scale)) === number;
};

export const toMinorUnits = (value, scale = 2) => Math.round(Number(value) * (10 ** scale));

export const stockDemandMicroUnits = (ingredientQuantity, productQuantity) =>
  BigInt(toMinorUnits(ingredientQuantity, 3)) * BigInt(toMinorUnits(productQuantity, 3));

export const stockDemandQuantity = (microUnits) => {
  const milliUnits = (microUnits + 500n) / 1000n;
  if (microUnits > 0n && milliUnits === 0n) throw new Error("Recipe consumption is below supported stock precision");
  if (milliUnits > 999_999_999_999n) throw new Error("Recipe consumption exceeds supported stock quantity");
  return Number(milliUnits) / 1000;
};

// Prices and quantities have two decimal places; round positive half-cents up.
export const orderLineCents = (price, quantity) => Math.round(toMinorUnits(price) * toMinorUnits(quantity) / 100);

// A purchase quantity has 3 decimal places and its unit cost has 4.
// BigInt keeps intermediate products exact even at the configured limits.
export const purchaseLineCents = (quantity, unitCost) => {
  const product = BigInt(toMinorUnits(quantity, 3)) * BigInt(toMinorUnits(unitCost, 4));
  return (product + 50_000n) / 100_000n;
};

export const weightedStockCost = (currentQuantity, currentCost, addedQuantity, addedCost) => {
  const existing = BigInt(toMinorUnits(currentQuantity, 3));
  const added = BigInt(toMinorUnits(addedQuantity, 3));
  if (added === 0n) return Number(currentCost);
  const total = existing + added;
  const weighted = existing * BigInt(toMinorUnits(currentCost, 4)) + added * BigInt(toMinorUnits(addedCost, 4));
  return Number((weighted + total / 2n) / total) / 10_000;
};

export const reverseWeightedStockCost = (remainingQuantity, currentCost, removedQuantity, removedCost) => {
  const remaining = BigInt(toMinorUnits(remainingQuantity, 3));
  if (remaining <= 0n) return 0;
  const removed = BigInt(toMinorUnits(removedQuantity, 3));
  const totalValue = (remaining + removed) * BigInt(toMinorUnits(currentCost, 4));
  const removedValue = removed * BigInt(toMinorUnits(removedCost, 4));
  const remainingValue = totalValue > removedValue ? totalValue - removedValue : 0n;
  return Number((remainingValue + remaining / 2n) / remaining) / 10_000;
};

export const discountCents = (subtotalCents, type, value) => {
  const discount = type === "percentage"
    ? Math.round(subtotalCents * toMinorUnits(value) / 10_000)
    : toMinorUnits(value);
  return Math.min(subtotalCents, discount);
};
