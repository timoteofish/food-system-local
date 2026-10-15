export const generateId = (prefix = "id") =>
  `${prefix}-${Math.random().toString(36).slice(2, 9)}-${Date.now().toString(36)}`;

export const parsePrice = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const normalized = String(value ?? "0")
    .replace(/R\$\s?/gi, "")
    .trim()
    .replace(/\./g, "")
    .replace(",", ".");

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const formatPrice = (value, { prefix = true } = {}) => {
  const amount = parsePrice(value);
  const formatted = amount.toFixed(2).replace(".", ",");
  return prefix ? `R$ ${formatted}` : formatted;
};

export const formatTime = (date = new Date()) =>
  date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

export const isSameDay = (left, right = new Date()) => {
  const a = new Date(left);
  const b = new Date(right);
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
};

export const getInitials = (name = "") => {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "F";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
};

export const escapeHtml = (value = "") =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export const safeImageUrl = (value = "") => {
  const url = String(value || "").trim();
  if (!url) return "";

  try {
    const parsed = new URL(url, window.location.href);
    return ["http:", "https:", "data:"].includes(parsed.protocol) ? parsed.href : "";
  } catch {
    return "";
  }
};
