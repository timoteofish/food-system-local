import { getLegacyTranslationCandidates } from "../i18n/i18n.js";

const KEYS = {
  MENU_SETTINGS: "food-system-menu-settings",
  CART: "food-system-menu-cart",
  SESSION: "food-system-session",
  BUSINESS: "food-system-business",
};

const defaultMenuSettings = {
  businessName: "",
  menuName: "",
  primaryColor: "#c52236",
  gradientStart: "#c52236",
  gradientEnd: "#191919",
  gradientAngle: 140,
  style: "clean",
  heroMood: "minimal",
  menuDensity: 42,
  menuBanner: "",
  deliveryFee: 0,
  showAllProducts: true,
  selectedCategories: [],
};

const legacyMenuText = {
  businessName: "Mountain Flavor",
  menuName: "Order at your table without installing an app",
  menuBanner: "Scan the code, choose your items, and send the order directly to the team",
};

const defaultBusiness = {
  name: "",
  email: "",
  phone: "",
};

const readJson = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
};

const writeJson = (key, value) => {
  localStorage.setItem(key, JSON.stringify(value));
};

export const getMenuSettings = () => {
  const settings = { ...defaultMenuSettings, ...readJson(KEYS.MENU_SETTINGS, defaultMenuSettings) };
  Object.entries(legacyMenuText).forEach(([key, value]) => {
    const legacyValues = getLegacyTranslationCandidates(value, "pt");
    if (settings[key] === value || legacyValues.includes(settings[key])) settings[key] = "";
  });
  return settings;
};

export const saveMenuSettings = (settings) => {
  writeJson(KEYS.MENU_SETTINGS, settings);
};

export const getCart = () => {
  const cart = readJson(KEYS.CART, {});
  if (!cart || typeof cart !== "object") return {};
  return Object.fromEntries(
    Object.entries(cart).filter(([id, quantity]) => Boolean(id) && Number(quantity) > 0)
  );
};

export const saveCart = (cart) => {
  writeJson(KEYS.CART, cart);
};

export const clearCart = () => {
  localStorage.removeItem(KEYS.CART);
};

export const getSession = () => {
  const session = readJson(KEYS.SESSION, null);
  if (!session || typeof session !== "object") return null;
  return { ...session, token: "" };
};

export const setSession = (session) => {
  writeJson(KEYS.SESSION, session);
};

export const getBusiness = () => ({ ...defaultBusiness, ...readJson(KEYS.BUSINESS, defaultBusiness) });

export const saveBusiness = (business) => {
  writeJson(KEYS.BUSINESS, { ...getBusiness(), ...business });
};
