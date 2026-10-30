import { getLanguage, getLocale } from "../i18n/i18n.js";

export const generateId = (prefix = "id") =>
  `${prefix}-${Math.random().toString(36).slice(2, 9)}-${Date.now().toString(36)}`;

export const parsePrice = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  let normalized = String(value ?? "0").replace(/R\$|\$/gi, "").replace(/\s/g, "").trim();
  if (getLanguage() === "en") {
    normalized = normalized.replace(/,/g, "");
  } else {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const formatPrice = (value, { prefix = true } = {}) => {
  const amount = parsePrice(value);
  return new Intl.NumberFormat(getLocale(), prefix
    ? { style: "currency", currency: "BRL" }
    : { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
};

export const formatTime = (date = new Date()) =>
  date.toLocaleTimeString(getLocale(), { hour: "2-digit", minute: "2-digit" });

export const formatOrderLocation = (value) => {
  let location = value;
  if (typeof location === "string") {
    const text = location.trim();
    if (text.startsWith("{")) {
      try {
        location = JSON.parse(text);
      } catch {
        return text;
      }
    } else {
      return text;
    }
  }
  if (!location || typeof location !== "object" || Array.isArray(location)) return "";
  if (location.name) return String(location.name).trim();
  return [location.street, location.number, location.complement, location.neighborhood, location.city, location.state]
    .filter((part) => part !== undefined && part !== null)
    .map((part) => String(part).trim())
    .filter(Boolean)
    .join(", ");
};

const inventoryUnitLabels = {
  unit: { pt: "Unidade", en: "Unit" },
  unidade: { pt: "Unidade", en: "Unit" },
  g: { pt: "g", en: "g" },
  gram: { pt: "g", en: "g" },
  grams: { pt: "g", en: "g" },
  grama: { pt: "g", en: "g" },
  gramas: { pt: "g", en: "g" },
  kg: { pt: "kg", en: "kg" },
  ml: { pt: "mL", en: "mL" },
  l: { pt: "L", en: "L" },
};

export const formatInventoryUnit = (value) => {
  const unit = String(value ?? "").trim();
  return inventoryUnitLabels[unit.toLowerCase()]?.[getLanguage()] || unit;
};

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
  if (/^data:/i.test(url)) {
    return /^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/]+={0,2}$/i.test(url) ? url : "";
  }

  try {
    const parsed = new URL(url, window.location.href);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : "";
  } catch {
    return "";
  }
};

