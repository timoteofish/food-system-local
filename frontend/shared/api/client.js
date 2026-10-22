import { API_BASE_URL } from "./config.js";
import { setSession } from "../data/storage.js";

const parseResponse = async (response) => {
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const message = data.error || data.message || "Erro na requisição.";
    throw new Error(message);
  }

  return data;
};

export const apiRequest = async (path, { method = "GET", body, auth = true } = {}) => {
  if (!API_BASE_URL) {
    throw new Error("URL da API nao configurada. Defina window.FOOD_SYSTEM_API_URL ou localStorage['food-system-api-url'].");
  }

  const headers = {
    Accept: "application/json",
    "X-Food-System-Client": "web",
    "X-Food-System-Local": "true",
    ...(body ? { "Content-Type": "application/json" } : {}),
  };
  const storedSession = JSON.parse(localStorage.getItem("food-system-session") || "null");
  if (storedSession?.token) headers.Authorization = `Bearer ${storedSession.token}`;

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined,
  });

  return parseResponse(response);
};

export const loginRequest = (email, password) =>
  apiRequest("/auth/login", {
    method: "POST",
    auth: false,
    body: { user: { email, password } },
  });

export const firebaseAuthRequest = (idToken) =>
  apiRequest("/auth/firebase", {
    method: "POST",
    auth: false,
    body: { firebase_auth: { id_token: idToken } },
  });

export const registerRequest = (payload) =>
  apiRequest("/auth/register", {
    method: "POST",
    auth: false,
    body: {
      user: {
        email: payload.email,
        password: payload.password,
        password_confirmation: payload.password,
        business_name: payload.businessName || payload.name,
        phone: payload.phone || "",
      },
    },
  });

export const logoutRequest = () => apiRequest("/auth/logout", { method: "POST" });

export const fetchProfile = () => apiRequest("/auth/profile");

export const fetchProducts = (businessId) =>
  apiRequest(`/businesses/${businessId}/products`).then((data) => data.products || []);

export const fetchPublicMenu = (businessId) =>
  apiRequest(`/businesses/${businessId}/public`, { auth: false });

export const fetchPublicMenuByTableToken = (tableToken) =>
  apiRequest(`/menu/${encodeURIComponent(tableToken)}`, { auth: false });

export const createProduct = (businessId, product) =>
  apiRequest(`/businesses/${businessId}/products`, {
    method: "POST",
    body: { product },
  }).then((data) => data.product || data);

export const updateProduct = (businessId, productId, product) =>
  apiRequest(`/businesses/${businessId}/products/${productId}`, {
    method: "PATCH",
    body: { product },
  }).then((data) => data.product || data);

export const fetchCategories = (businessId) =>
  apiRequest(`/businesses/${businessId}/categories`).then((data) => data.categories || []);

export const fetchRestaurantTables = (businessId) =>
  apiRequest(`/businesses/${businessId}/tables`).then((data) => data.tables || []);

export const createRestaurantTable = (businessId, name) =>
  apiRequest(`/businesses/${businessId}/tables`, {
    method: "POST",
    body: { restaurant_table: { name } },
  });

export const rotateRestaurantTableToken = (businessId, tableId) =>
  apiRequest(`/businesses/${businessId}/tables/${tableId}/rotate_token`, {
    method: "POST",
  });

export const fetchDiningTabs = (businessId) => apiRequest(`/businesses/${businessId}/dining-tabs`).then((data) => data.tabs || []);
export const openDiningTab = (businessId, tableId, customerId = null, notes = "") => apiRequest(`/businesses/${businessId}/tables/${tableId}/dining-tabs`, { method: "POST", body: { customer_id: customerId || undefined, notes } }).then((data) => data.tab || data);
export const transferDiningTab = (businessId, tabId, tableId) => apiRequest(`/businesses/${businessId}/dining-tabs/${tabId}/transfer`, { method: "POST", body: { table_id: tableId } }).then((data) => data.tab || data);
export const closeDiningTab = (businessId, tabId) => apiRequest(`/businesses/${businessId}/dining-tabs/${tabId}/close`, { method: "POST" }).then((data) => data.tab || data);

export const fetchTeamMembers = (businessId) =>
  apiRequest(`/businesses/${businessId}/team`);

export const createTeamMember = (businessId, membership) =>
  apiRequest(`/businesses/${businessId}/team`, {
    method: "POST",
    body: { membership },
  });

export const updateTeamMember = (businessId, membershipId, membership) =>
  apiRequest(`/businesses/${businessId}/team/${membershipId}`, {
    method: "PATCH",
    body: { membership },
  });

export const disableTeamMember = (businessId, membershipId) =>
  apiRequest(`/businesses/${businessId}/team/${membershipId}`, {
    method: "DELETE",
  });

export const createCategory = (businessId, name) =>
  apiRequest(`/businesses/${businessId}/categories`, {
    method: "POST",
    body: { category: { name } },
  }).then((data) => data.category || data);

export const deleteCategory = (businessId, categoryId) =>
  apiRequest(`/businesses/${businessId}/categories/${categoryId}`, {
    method: "DELETE",
  }).then(() => true);

export const updateBusiness = (businessId, business) =>
  apiRequest(`/businesses/${businessId}`, {
    method: "PATCH",
    body: { business },
  });

export const fetchOrders = (businessId) =>
  apiRequest(`/businesses/${businessId}/orders`).then((data) => data.orders || []);

export const updateOrderStatusRequest = (businessId, orderId, status) =>
  apiRequest(`/businesses/${businessId}/orders/${orderId}/update_status`, {
    method: "PATCH",
    body: { status },
  }).then((data) => data.order || data);

export const createOrder = (businessId, order, items, tableToken = "") =>
  apiRequest(`/businesses/${businessId}/orders`, {
    method: "POST",
    auth: false,
    body: { order, items, table_token: tableToken },
  });

export const fetchTodayStats = (businessId) =>
  apiRequest(`/businesses/${businessId}/orders/today_stats`).then((data) => ({
    total_revenue: data.total,
    total_orders: data.orders,
    cash_balance: data.total,
  }));

export const fetchCashMovements = (businessId) =>
  apiRequest(`/businesses/${businessId}/cash_movements`);

export const createCashMovement = (businessId, cashMovement) =>
  apiRequest(`/businesses/${businessId}/cash_movements`, {
    method: "POST",
    body: { cash_movement: cashMovement },
  }).then((data) => data.movement || data);

export const fetchCurrentCashRegister = (businessId) => apiRequest(`/businesses/${businessId}/cash-register/current`).then((data) => data.session);
export const openCashRegister = (businessId, openingAmount) => apiRequest(`/businesses/${businessId}/cash-register/open`, { method: "POST", body: { opening_amount: openingAmount } }).then((data) => data.session);
export const closeCashRegister = (businessId, sessionId, closingAmount, notes = "") => apiRequest(`/businesses/${businessId}/cash-register/${sessionId}/close`, { method: "POST", body: { closing_amount: closingAmount, notes } });

export const persistAuthSession = ({ user, business, token = "" }) => {
  setSession({
    userId: user.id,
    email: user.email,
    name: user.business_name || user.name,
    token,
    businessId: business?.id,
    needsOnboarding: false,
    loggedAt: new Date().toISOString(),
  });
};

export const pingApi = async () => {
  if (!API_BASE_URL) return false;

  try {
    const response = await fetch(`${API_BASE_URL.replace("/api/v1", "")}/up`);
    return response.ok;
  } catch {
    return false;
  }
};

export const checkForUpdates = (businessId) =>
  apiRequest(`/businesses/${businessId}/system/update`);
