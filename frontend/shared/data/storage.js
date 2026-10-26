const KEYS = {
  MENU_SETTINGS: "food-system-menu-settings",
  CART: "food-system-menu-cart",
  SESSION: "food-system-session",
  BUSINESS: "food-system-business",
  REMEMBERED_USER: "fs_remembered_user",
  PENDING_REGISTRATION: "food-system-pending-registration",
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
  showAllProducts: true,
  selectedCategories: [],
  category: "Todos",
};

const legacyMenuText = {
  businessName: "Sabor da Serra",
  menuName: "Peça à mesa sem instalar o aplicativo",
  menuBanner: "Aponte a câmera, escolha seus itens e envie o pedido direto para a equipe",
};

const defaultBusiness = {
  name: "",
  email: "",
  phone: "",
};

const readJson = (key, fallback) => {
  try {
    const store = key === KEYS.PENDING_REGISTRATION ? sessionStorage : localStorage;
    const raw = store.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
};

const writeJson = (key, value) => {
  const store = key === KEYS.PENDING_REGISTRATION ? sessionStorage : localStorage;
  store.setItem(key, JSON.stringify(value));
};

export const getMenuSettings = () => {
  const settings = { ...defaultMenuSettings, ...readJson(KEYS.MENU_SETTINGS, defaultMenuSettings) };
  Object.entries(legacyMenuText).forEach(([key, value]) => {
    if (settings[key] === value) settings[key] = "";
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

export const clearSession = () => {
  localStorage.removeItem(KEYS.SESSION);
};

export const getBusiness = () => ({ ...defaultBusiness, ...readJson(KEYS.BUSINESS, defaultBusiness) });

export const saveBusiness = (business) => {
  writeJson(KEYS.BUSINESS, { ...getBusiness(), ...business });
};

export const getPendingRegistration = () => readJson(KEYS.PENDING_REGISTRATION, null);

export const savePendingRegistration = (data) => {
  writeJson(KEYS.PENDING_REGISTRATION, data);
};

export const clearPendingRegistration = () => {
  sessionStorage.removeItem(KEYS.PENDING_REGISTRATION);
  localStorage.removeItem(KEYS.PENDING_REGISTRATION);
};

export const getRememberedUser = () => localStorage.getItem(KEYS.REMEMBERED_USER) || "";

export const setRememberedUser = (email) => {
  if (email) {
    localStorage.setItem(KEYS.REMEMBERED_USER, email);
  } else {
    localStorage.removeItem(KEYS.REMEMBERED_USER);
  }
};

export { KEYS };
