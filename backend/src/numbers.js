export const hasDecimalScale = (value, scale) => {
  if ((typeof value !== "number" && typeof value !== "string") || !String(value).trim()) return false;
  const number = Number(value);
  return Number.isFinite(number) && Number(number.toFixed(scale)) === number;
};

export const toMinorUnits = (value, scale = 2) => Math.round(Number(value) * (10 ** scale));
