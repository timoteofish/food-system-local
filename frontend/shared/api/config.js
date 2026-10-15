const normalizeApiUrl = (value) => String(value || "").trim().replace(/\/+$/, "");

const resolveDefaultApiUrl = () => {
  const hostname = window.location.hostname;
  const isLocal = ["localhost", "127.0.0.1", ""].includes(hostname);
  if (isLocal) return "http://localhost:3000/api/v1";
  return "";
};

export const API_BASE_URL =
  normalizeApiUrl(window.FOOD_SYSTEM_API_URL) ||
  normalizeApiUrl(localStorage.getItem("food-system-api-url")) ||
  resolveDefaultApiUrl();

export const isApiEnabled = () => Boolean(API_BASE_URL);
