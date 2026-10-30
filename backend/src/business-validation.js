export const hasValidBusinessName = (value) =>
  typeof value === "string" && value.trim().length >= 2 && value.trim().length <= 160;

export const hasValidBusinessDescription = (value) =>
  typeof value === "string" && Buffer.byteLength(value, "utf8") <= 65535;

export const hasValidBusinessColor = (value) =>
  typeof value === "string" && /^#[\da-f]{6}$/i.test(value);
