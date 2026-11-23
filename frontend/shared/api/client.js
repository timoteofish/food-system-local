import { API_BASE_URL } from "./config.js";
import { localizeApiError } from "./error-messages.js";

const isLocalAdminApi = (() => {
  try {
    const url = new URL(API_BASE_URL);
    return url.protocol === "http:" &&
      url.hostname === "127.0.0.1" &&
      url.port === "3000" &&
      url.pathname === "/api/v1" &&
      !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
})();

const parseResponse = async (response) => {
  let data;
  try {
    const text = await response.text();
    data = text ? JSON.parse(text) : {};
  } catch (error) {
    throw new Error("O servidor retornou uma resposta inválida.", { cause: error });
  }

  if (!response.ok) {
    const message = data.error || data.message || "Request failed";
    const error = new Error(localizeApiError(message));
    error.apiMessage = message;
    error.status = response.status;
    throw error;
  }

  return data;
};

export const apiRequest = async (path, { method = "GET", body, auth = true, idempotencyKey } = {}) => {
  if (!API_BASE_URL) {
    throw new Error(localizeApiError("The API URL is not configured. Set window.FOOD_SYSTEM_API_URL or localStorage['food-system-api-url']"));
  }

  const needsAuthentication = auth !== false;
  let localAccessToken = "";
  if (needsAuthentication && isLocalAdminApi) {
    try {
      localAccessToken = await window.__TAURI__?.core?.invoke?.("local_access_token") || "";
    } catch {
      // Do not send stored session credentials to a service that has not passed
      // the desktop launcher readiness handshake on the trusted loopback API.
      throw new Error(localizeApiError("The local API is not ready yet. Try again shortly."));
    }
  }
  const developmentLocalMode = needsAuthentication && isLocalAdminApi && !localAccessToken && ["localhost", "127.0.0.1"].includes(window.location.hostname) && window.location.port === "4173";
  const headers = {
    Accept: "application/json",
    "X-Food-System-Client": "web",
    ...(localAccessToken ? { "X-Food-System-Local": localAccessToken } : developmentLocalMode ? { "X-Food-System-Local": "true" } : {}),
    ...(body ? { "Content-Type": "application/json" } : {}),
    ...(typeof idempotencyKey === "string" && idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
  };
  if (needsAuthentication) {
    const storedSession = JSON.parse(localStorage.getItem("food-system-session") || "null");
    if (storedSession?.token) headers.Authorization = `Bearer ${storedSession.token}`;
  }

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      credentials: needsAuthentication ? "same-origin" : "omit",
      redirect: "error",
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    throw new Error("Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.", { cause: error });
  }

  return parseResponse(response);
};

export const apiDownloadRequest = async (path) => {
  if (!API_BASE_URL) {
    throw new Error(localizeApiError("The API URL is not configured. Set window.FOOD_SYSTEM_API_URL or localStorage['food-system-api-url']"));
  }

  let localAccessToken = "";
  if (isLocalAdminApi) {
    try {
      localAccessToken = await window.__TAURI__?.core?.invoke?.("local_access_token") || "";
    } catch {
      throw new Error(localizeApiError("The local API is not ready yet. Try again shortly."));
    }
  }
  const developmentLocalMode = isLocalAdminApi && !localAccessToken && ["localhost", "127.0.0.1"].includes(window.location.hostname) && window.location.port === "4173";
  const headers = {
    Accept: "application/octet-stream",
    "X-Food-System-Client": "web",
    ...(localAccessToken ? { "X-Food-System-Local": localAccessToken } : developmentLocalMode ? { "X-Food-System-Local": "true" } : {}),
  };
  const storedSession = JSON.parse(localStorage.getItem("food-system-session") || "null");
  if (storedSession?.token) headers.Authorization = `Bearer ${storedSession.token}`;

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: "GET",
      headers,
      credentials: "same-origin",
      redirect: "error",
    });
  } catch (error) {
    throw new Error("Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.", { cause: error });
  }

  if (!response.ok) {
    let data = {};
    try { data = await response.json(); } catch {}
    const message = data.error || data.message || "Request failed";
    const error = new Error(localizeApiError(message));
    error.apiMessage = message;
    error.status = response.status;
    throw error;
  }
  return response.blob();
};

export const fetchBusiness = (businessId) => apiRequest(`/businesses/${businessId}`).then((data) => data.business);

export const provisionLocalBusiness = (name) =>
  apiRequest("/local/business", { method: "PUT", body: { business: { name } } }).then((data) => data.business);

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

export const fetchTeamMembers = (businessId) =>
  apiRequest(`/businesses/${businessId}/team`).then((data) => data.members || []);

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

export const fetchOrders = (businessId, { activeOnly = false, recentOnly = false } = {}) =>
  apiRequest(`/businesses/${businessId}/orders${activeOnly ? "?view=active" : recentOnly ? "?view=recent" : ""}`).then((data) => data.orders || []);

export const updateOrderStatusRequest = (businessId, orderId, status) =>
  apiRequest(`/businesses/${businessId}/orders/${orderId}/update_status`, {
    method: "PATCH",
    body: { status },
  }).then((data) => data.order || data);

export const createOrder = (businessId, order, items, tableToken = "", delivery = null, idempotencyKey = globalThis.crypto.randomUUID()) =>
  apiRequest(`/businesses/${businessId}/orders`, {
    method: "POST",
    auth: false,
    body: { order, items, table_token: tableToken, delivery, idempotency_key: idempotencyKey },
  });

export const fetchTodayStats = (businessId) =>
  apiRequest(`/businesses/${businessId}/orders/today_stats`).then((data) => ({
    total_revenue: data.total,
    total_orders: data.orders,
    cash_balance: data.total,
  }));

export const fetchCashMovements = (businessId) =>
  apiRequest(`/businesses/${businessId}/cash_movements`);

export const createCashMovement = (businessId, cashMovement, idempotencyKey) =>
  apiRequest(`/businesses/${businessId}/cash_movements`, {
    method: "POST",
    body: { cash_movement: cashMovement },
    idempotencyKey,
  }).then((data) => data.movement || data);

export const fetchCurrentCashRegister = (businessId) => apiRequest(`/businesses/${businessId}/cash-register/current`).then((data) => data.session);
export const openCashRegister = (businessId, openingAmount) => apiRequest(`/businesses/${businessId}/cash-register/open`, { method: "POST", body: { opening_amount: openingAmount } }).then((data) => data.session);
export const closeCashRegister = (businessId, sessionId, closingAmount, notes = "") => apiRequest(`/businesses/${businessId}/cash-register/${sessionId}/close`, { method: "POST", body: { closing_amount: closingAmount, notes } });

export const pingApi = async () => {
  if (!API_BASE_URL) return false;

  try {
    const response = await fetch(`${API_BASE_URL}/health`, {
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) return false;
    const health = await response.json();
    return health?.status === "ok" && health?.database === "ok";
  } catch {
    return false;
  }
};

export const checkForUpdates = (businessId) =>
  apiRequest(`/businesses/${businessId}/system/update`);
