const normalizeApiUrl = (value) => String(value || "").trim().replace(/\/+$/, "");

const getStoredApiUrl = () => {
  try {
    return localStorage.getItem("food-system-api-url") || "";
  } catch {
    return "";
  }
};

const resolveDefaultApiUrl = () => {
  const hostname = window.location.hostname;
  const isLocal = ["localhost", "127.0.0.1", "tauri.localhost", ""].includes(hostname);
  if (isLocal) return "http://127.0.0.1:3000/api/v1";
  return `${window.location.origin}/api/v1`;
};

export const API_BASE_URL =
  normalizeApiUrl(window.FOOD_SYSTEM_API_URL) ||
  normalizeApiUrl(getStoredApiUrl()) ||
  resolveDefaultApiUrl();

export const isApiEnabled = () => Boolean(API_BASE_URL);
