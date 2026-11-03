import {
  createRestaurantTable,
  createTeamMember,
  createOrder as apiCreateOrder,
  createProduct as apiCreateProduct,
  createCategory as apiCreateCategory,
  deleteCategory as apiDeleteCategory,
  fetchCategories,
  fetchCashMovements,
  fetchOrders,
  fetchProducts,
  fetchRestaurantTables,
  fetchTeamMembers,
  fetchTodayStats,
  fetchBusiness,
  fetchProfile,
  provisionLocalBusiness,
  firebaseAuthRequest,
  loginRequest,
  logoutRequest,
  persistAuthSession,
  pingApi,
  registerRequest,
  createCashMovement as apiCreateCashMovement,
  updateOrderStatusRequest,
  updateBusiness,
  updateTeamMember,
  updateProduct as apiUpdateProduct,
  disableTeamMember,
  checkForUpdates,
} from "../api/client.js";
import { legacyOrderNoteLabels, legacyPaymentMethodEntries } from "../compatibility/legacy-portuguese-data.js";
import { PAYMENT_METHODS } from "../domain/payment-methods.js";
import { isApiEnabled } from "../api/config.js";
import {
  clearPendingRegistration,
  clearSession,
  getPendingRegistration,
  getSession,
  saveBusiness,
  savePendingRegistration,
  setSession,
  getBusiness,
} from "../data/storage.js";
import { formatOrderLocation } from "../utils/utils.js";
import { getLocale, translate } from "../i18n/i18n.js";
import { signInWithFirebaseGoogle, signOutFirebaseSession } from "./firebase.js";

// This is an installed, single-computer application. The local profile is
// created automatically; there is no login, password or subscription flow.
const LOCAL_MODE = true;
const BUSINESS_TYPE_LABELS = {
  restaurant: "Restaurant",
  snack_bar: "Snack bar",
  pizzeria: "Pizzeria",
  burger_restaurant: "Burger restaurant",
  coffee_shop: "Coffee shop",
};
const SERVICE_MODEL_LABELS = {
  table_service: "Table service",
  counter_pickup: "Counter and pickup",
  delivery_pickup: "Delivery and pickup",
  mixed: "Mixed service",
};

const ensureLocalSession = () => {
  const existing = getSession();
  if (existing?.local === true && existing.businessId) return existing;

  const localSession = {
    id: "local-user",
    email: "local@food-system.local",
    name: translate("Administrator"),
    businessId: "00000000-0000-4000-8000-000000000001",
    role: "owner",
    provider: "local",
    local: true,
    token: "",
  };
  setSession(localSession);
  saveBusiness({
    id: localSession.businessId,
    name: getBusiness()?.name || translate("My business"),
    email: "local@food-system.local",
    onboardingCompleted: true,
  });
  return localSession;
};

let apiAvailable = null;

export const checkApiAvailability = async () => {
  if (!isApiEnabled()) {
    apiAvailable = false;
    return false;
  }
  apiAvailable = await pingApi();
  if (apiAvailable && LOCAL_MODE) {
    const localSession = ensureLocalSession();
    const localName = String(getBusiness()?.name || "").trim();
    if (localName) {
      try {
        const business = await provisionLocalBusiness(localName);
        saveBusiness({ id: business.id, name: business.name });
      } catch {
        // Keep the interface usable if the local profile cannot sync yet.
      }
    }
  } else if (apiAvailable && getSession()?.token) {
    const profile = await fetchProfile();
    persistAuthSession({ user: profile.user, business: profile.business, local: true });
  }
  return apiAvailable;
};

export const isUsingApi = () => apiAvailable === true;
export const isLocalMode = () => LOCAL_MODE;

const requireBusinessId = () => {
  const businessId = getSession()?.businessId;
  if (!businessId) throw new Error("Session expired Sign in again");
  return businessId;
};

export const login = async ({ email, password }) => {
  await checkApiAvailability();
  if (!isUsingApi()) throw new Error("API unavailable Check the backend before signing in");

  const data = await loginRequest(email, password);
  persistAuthSession({ user: data.user, business: data.business, token: data.token });
  return data.user;
};

export const loginWithGoogle = async () => {
  throw new Error("Use loginWithFirebaseGoogle to sign in with Google");
};

export const loginWithFirebaseGoogle = async () => {
  await checkApiAvailability();

  if (!isUsingApi()) {
    throw new Error("Firebase sign-in requires the API to be active");
  }

  const { idToken } = await signInWithFirebaseGoogle();
  const data = await firebaseAuthRequest(idToken);
  persistAuthSession({ user: data.user, business: data.business, token: data.token });
  setSession({
    ...getSession(),
    needsOnboarding: !data.business?.city || !data.business?.phone,
  });
  return data.user;
};

export const logout = async () => {
  if (LOCAL_MODE) return ensureLocalSession();
  if (getSession()) {
    try {
      await logoutRequest();
    } catch {
    }
  }
  await signOutFirebaseSession();
  clearSession();
};

export const getCurrentUser = () => {
  if (LOCAL_MODE) return ensureLocalSession();
  const session = getSession();
  if (!session?.email) return null;
  return session;
};

export const isAuthenticated = () => Boolean(getSession()?.email);

export const requireAuth = () => {
  if (LOCAL_MODE) return ensureLocalSession();
  if (isAuthenticated()) return getCurrentUser();
  window.location.replace("../../auth/login/index.html");
  return null;
};

export const saveRegistrationStep = ({ name, email, password }) => {
  savePendingRegistration({
    name: String(name || "").trim(),
    email: String(email || "").trim().toLowerCase(),
    password,
    savedAt: new Date().toISOString(),
  });
};

export const completeRegistration = async () => {
  const pending = getPendingRegistration();
  if (!pending?.email || !pending?.password) {
    throw new Error("Registration is incomplete Go back and complete your details");
  }
  if (!pending?.businessName) {
    throw new Error("Enter the business details before completing registration");
  }

  await checkApiAvailability();

  if (!isUsingApi()) throw new Error("API unavailable You cannot register without the backend");

  const data = await registerRequest(pending);
  persistAuthSession({
    user: data.user,
    business: data.business,
    token: data.token,
  });
  setSession({
    ...getSession(),
    name: pending.businessName,
    avatar: pending.businessAvatar || "",
    needsOnboarding: false,
  });
  saveBusiness({
    ...(data.business || {}),
    name: pending.businessName,
    email: pending.email,
    avatar: pending.businessAvatar || "",
    logo_url: pending.businessAvatar || data.business?.logo_url || "",
    onboardingCompleted: true,
  });
  await saveMenuSettingsRemote({
    businessName: pending.businessName,
    menuName: pending.businessName,
  });
  clearPendingRegistration();
  return data.user;
};

export const completeBusinessOnboarding = async (payload) => {
  const businessName = String(payload.businessName || "").trim();
  const businessType = String(payload.businessType || "").trim();
  const phone = String(payload.phone || "").trim();
  const city = String(payload.city || "").trim();
  const serviceModel = String(payload.serviceModel || "").trim();

  if (!businessName || !businessType || !city) {
    throw new Error("Complete the main business details to continue");
  }

  await checkApiAvailability();
  if (!isUsingApi()) throw new Error("API unavailable Could not save the business");

  const businessId = requireBusinessId();
  const businessTypeLabel = translate(BUSINESS_TYPE_LABELS[businessType] || businessType);
  const serviceModelLabel = translate(SERVICE_MODEL_LABELS[serviceModel] || serviceModel);
  await updateBusiness(businessId, {
    name: businessName,
    description: `${businessTypeLabel} • ${serviceModelLabel}`,
    phone,
    city,
  });

  saveBusiness({
    name: businessName,
    phone,
    city,
    businessType,
    serviceModel,
    onboardingCompleted: true,
  });

  const currentSession = getSession();
  if (currentSession) {
    setSession({
      ...currentSession,
      name: businessName,
      needsOnboarding: false,
    });
  }

  const menuSettings = {
    businessName,
    menuName: businessName,
  };

  await saveMenuSettingsRemote(menuSettings);

  return {
    businessName,
    businessType,
    phone,
    city,
    serviceModel,
  };
};

export const loadProducts = async () => {
  const businessId = requireBusinessId();
  return fetchProducts(businessId);
};

export const saveProduct = async (product) => {
  const businessId = requireBusinessId();
  const payload = {
    name: product.name,
    description: product.description,
    price: product.price,
    category: product.category,
    image: product.image,
    active: product.active,
  };

  if (product.id && !String(product.id).startsWith("prod-")) {
    return apiUpdateProduct(businessId, product.id, payload);
  }

  return apiCreateProduct(businessId, payload);
};

export const toggleProductStatus = async (product) => {
  const businessId = requireBusinessId();
  return apiUpdateProduct(businessId, product.id, { active: !product.active });
};

export const loadCategories = async () => {
  const businessId = requireBusinessId();
  const categories = await fetchCategories(businessId);
  return categories.map((item) => item.name);
};

export const addCategoryRemote = async (name) => {
  const businessId = requireBusinessId();
  await apiCreateCategory(businessId, name);
  return loadCategories();
};

export const loadRestaurantTablesRemote = async () => {
  const businessId = requireBusinessId();
  return fetchRestaurantTables(businessId);
};

export const ensureRestaurantTableRemote = async (name) => {
  const businessId = requireBusinessId();
  return createRestaurantTable(businessId, name);
};

export const loadTeamMembersRemote = async () => {
  const businessId = requireBusinessId();
  return fetchTeamMembers(businessId);
};

export const inviteTeamMemberRemote = async (membership) => {
  const businessId = requireBusinessId();
  return createTeamMember(businessId, membership);
};

export const updateTeamMemberRemote = async (membershipId, membership) => {
  const businessId = requireBusinessId();
  return updateTeamMember(businessId, membershipId, membership);
};

export const disableTeamMemberRemote = async (membershipId) => {
  const businessId = requireBusinessId();
  return disableTeamMember(businessId, membershipId);
};

export const removeCategoryRemote = async (name) => {
  const businessId = requireBusinessId();
  const categories = await fetchCategories(businessId);
  const match = categories.find((item) => item.name.toLowerCase() === name.toLowerCase());
  if (match) await apiDeleteCategory(businessId, match.id);
  return loadCategories();
};

export const saveMenuSettingsRemote = async (settings) => {
  if (!isUsingApi()) throw new Error("API unavailable Could not save the menu");

  const businessId = requireBusinessId();
  const currentBusiness = await fetchBusiness(businessId);
  let currentSettings = currentBusiness?.settings;
  if (typeof currentSettings === "string") {
    try { currentSettings = JSON.parse(currentSettings); } catch { currentSettings = {}; }
  }
  await updateBusiness(businessId, {
    name: settings.businessName,
    description: settings.menuName,
    primary_color: settings.primaryColor,
    theme_style: settings.style,
    settings: {
      ...(currentSettings && typeof currentSettings === "object" && !Array.isArray(currentSettings) ? currentSettings : {}),
      gradient_start: settings.gradientStart,
      gradient_end: settings.gradientEnd,
      gradient_angle: settings.gradientAngle,
      style: settings.style,
      menu_banner: settings.menuBanner,
      delivery_fee: settings.deliveryFee,
      show_all_products: settings.showAllProducts,
      selected_categories: settings.selectedCategories || [],
    },
  });

  const { saveMenuSettings } = await import("../data/storage.js");
  saveMenuSettings(settings);
  return settings;
};

export const placeOrderRemote = async ({
  items,
  total,
  paymentMethod = PAYMENT_METHODS.COUNTER,
  customerName = translate("Walk-in customer"),
  tableName = translate("Table not specified"),
  notes = "",
}) => {
  const businessId = requireBusinessId();
  const orderItems = items.map((item) => ({
    product_id: item.id,
    quantity: item.quantity,
  }));

  const data = await apiCreateOrder(
    businessId,
    {
      customer_name: customerName,
      notes: `${translate("orderTableNoteLabel")}${tableName} | ${translate("orderPaymentNoteLabel")}${paymentMethod}${notes ? ` | ${notes}` : ""}`,
    },
    orderItems
  );

  return data.order;
};

export const loadOrdersRemote = async () => {
  const businessId = requireBusinessId();
  const orders = await fetchOrders(businessId);
  return (orders || []).map((order) => ({
    id: order.id,
    total: order.total,
    createdAt: order.created_at,
    updatedAt: order.updated_at,
    items: order.items || [],
    customerName: order.customer_name || translate("Walk-in customer"),
    tableName: formatOrderLocation(order.table_name || order.restaurant_table_name || order.delivery_address) || extractTableName(order.notes),
    notes: order.notes || "",
    paymentMethod: extractPaymentMethod(order.notes),
    status: normalizeOrderStatus(order.status),
  }));
};

export const updateOrderStatusRemote = async (orderId, status) => {
  const businessId = requireBusinessId();
  const updated = await updateOrderStatusRequest(businessId, orderId, normalizeApiOrderStatus(status));
  return {
    id: updated.id,
    total: updated.total,
    createdAt: updated.created_at,
    updatedAt: updated.updated_at,
    items: updated.items || [],
    customerName: updated.customer_name || translate("Walk-in customer"),
    tableName: formatOrderLocation(updated.table_name || updated.restaurant_table_name || updated.delivery_address) || extractTableName(updated.notes),
    notes: updated.notes || "",
    paymentMethod: extractPaymentMethod(updated.notes),
    status: normalizeOrderStatus(updated.status),
  };
};

const extractTableName = (notes = "") => {
  const match = String(notes).match(new RegExp(`(?:Table|${legacyOrderNoteLabels.table}):\\s*([^|]+)`, "i"));
  return match ? match[1].trim() : translate("Table not specified");
};

const extractPaymentMethod = (notes = "") => {
  const match = String(notes).match(new RegExp(`\\b(?:${legacyOrderNoteLabels.payment}|Payment):\\s*([^|]+)`, "i"));
  if (!match) return PAYMENT_METHODS.COUNTER;
  const value = match[1].trim();
  const normalized = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const methods = new Map([
    ...legacyPaymentMethodEntries,
    [PAYMENT_METHODS.CASH_AT_COUNTER, PAYMENT_METHODS.CASH_AT_COUNTER],
    ["cash at counter", PAYMENT_METHODS.CASH_AT_COUNTER],
    [PAYMENT_METHODS.CREDIT_CARD, PAYMENT_METHODS.CREDIT_CARD],
    ["credit card", PAYMENT_METHODS.CREDIT_CARD],
    [PAYMENT_METHODS.DEBIT_CARD, PAYMENT_METHODS.DEBIT_CARD],
    ["debit card", PAYMENT_METHODS.DEBIT_CARD],
    [PAYMENT_METHODS.PIX, PAYMENT_METHODS.PIX],
  ]);
  return methods.get(normalized) || value;
};

const normalizeOrderStatus = (status = "") => {
  const value = String(status).toLowerCase();
  if (value === "confirmed" || value === "pending") return "new";
  if (value === "preparing") return "preparing";
  if (value === "ready") return "ready";
  if (value === "delivered") return "completed";
  if (value === "cancelled") return "cancelled";
  return "new";
};

const normalizeApiOrderStatus = (status = "") => {
  if (status === "new") return "confirmed";
  if (status === "preparing") return "preparing";
  if (status === "ready") return "ready";
  if (status === "completed") return "delivered";
  if (status === "cancelled") return "cancelled";
  return "confirmed";
};

export const loadDashboardData = async () => {
  const businessId = requireBusinessId();
  const [statsPayload, orders] = await Promise.all([
    fetchTodayStats(businessId),
    fetchOrders(businessId),
  ]);

  const products = await loadProducts();
  const activeLocations = new Set(
    (orders || [])
      .filter((order) => ["confirmed", "pending", "preparing", "ready"].includes(String(order.status || "").toLowerCase()))
      .map((order) => formatOrderLocation(order.table_name || order.restaurant_table_name || order.delivery_address) || extractTableName(order.notes))
      .filter((location) => location && location !== translate("Table not specified"))
      .map((location) => location.toLocaleLowerCase(getLocale()))
  );

  return {
    stats: {
      activeProducts: products.filter((item) => item.active).length,
      ordersValueToday: Number(statsPayload.total_revenue || 0),
      ordersToday: Number(statsPayload.total_orders || 0),
      activeLocations: activeLocations.size,
    },
    orders: (orders || [])
      .slice()
      .sort((left, right) => new Date(right.created_at) - new Date(left.created_at))
      .slice(0, 3)
      .map((order) => ({
        id: order.id,
        orderCode: order.order_number || order.orderCode || "",
        total: Number(order.total ?? order.total_amount ?? 0),
        createdAt: order.created_at,
        items: order.items || [],
      })),
  };
};

export const loadCashierData = async () => {
  const businessId = requireBusinessId();
  const [orders, cashPayload] = await Promise.all([
    fetchOrders(businessId),
    fetchCashMovements(businessId),
  ]);

  const movements = (Array.isArray(cashPayload?.movements) ? cashPayload.movements : []).map((movement) => {
    const originalType = String(movement.type || movement.movement_type || "entry").toLowerCase();
    const type = originalType === "withdrawal" || originalType === "exit" ? "exit" : "entry";
    const amount = Number(movement.amount ?? movement.value ?? 0);
    const value = Number.isFinite(amount) ? amount : 0;
    const fallbackLabel = originalType === "sale"
      ? translate("Sale recorded")
      : type === "exit" ? translate("Cash outflow") : translate("Cash inflow");
    const label = movement.description || movement.label || fallbackLabel;
    return {
      ...movement,
      type,
      label,
      value,
      createdAt: movement.created_at || movement.createdAt || "",
    };
  });
  const entriesTotal = movements
    .filter((movement) => movement.type === "entry")
    .reduce((total, movement) => total + movement.value, 0);
  const exitsTotal = movements
    .filter((movement) => movement.type === "exit")
    .reduce((total, movement) => total + movement.value, 0);
  const reportedBalance = Number(cashPayload?.balance);

  return {
    orders: (orders || []).map((order) => ({
      id: order.id,
      orderCode: order.order_number,
      total: order.total,
      paymentMethod: extractPaymentMethod(order.notes),
      paymentStatus: order.status === "completed" ? "paid" : "pending",
      customerName: order.customer_name || translate("Customer"),
      tableName: formatOrderLocation(order.table_name || order.restaurant_table_name || order.delivery_address) || extractTableName(order.notes),
      createdAt: order.created_at,
    })),
    movements,
    stats: {
      entriesTotal,
      exitsTotal,
      cashBalance: Number.isFinite(reportedBalance) ? reportedBalance : entriesTotal - exitsTotal,
    },
  };
};

export const addCashMovementRemote = async ({ type, label, value }) => {
  const businessId = requireBusinessId();
  return apiCreateCashMovement(businessId, {
    movement_type: type,
    label,
    amount: value,
  });
};

export const bootstrapApi = checkApiAvailability;

export const checkForSystemUpdates = async () => {
  await checkApiAvailability();
  if (!isUsingApi()) throw new Error("API unavailable Could not check for updates");
  const businessId = requireBusinessId();
  return checkForUpdates(businessId);
};
