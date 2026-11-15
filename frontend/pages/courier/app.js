import { API_BASE_URL } from "../../shared/api/config.js";
import { getLocale } from "../../shared/i18n/i18n.js";
import { applyCourierTranslations, translateCourier } from "./translations.js";

if ("serviceWorker" in navigator && location.protocol === "https:") {
  void navigator.serviceWorker.register("./sw.js");
}

const tokenKey = "food-system-courier-token";
let sessionVersion = 0;
let loadVersion = 0;
let deliveryUpdateInProgress = false;
let backgroundRefreshInProgress = false;
const elements = {
  tokenInput: document.getElementById("courierToken"),
  form: document.getElementById("tokenForm"),
  message: document.getElementById("message"),
  deliveries: document.getElementById("deliveries"),
  clearToken: document.getElementById("clearToken"),
  sendLocation: document.getElementById("sendLocation"),
};

const statusLabels = {
  assigned: "Waiting for pickup",
  picked_up: "In transit",
  delivered: "Delivered",
  cancelled: "Cancelled",
};
const actionLabels = {
  picked_up: "Start delivery",
  delivered: "Complete delivery",
};

const escapeHtml = (value) => String(value ?? "").replace(/[&<>\'"]/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "'": "&#39;",
  '"': "&quot;",
}[character]));

const getToken = () => localStorage.getItem(tokenKey) || "";

const parseResponse = async (response) => {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Could not access deliveries");
  }
  return data;
};

const parseDeliveryAddress = (value) => {
  if (typeof value === "string") {
    try { value = JSON.parse(value); }
    catch { return { street: value }; }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
};

const renderDelivery = (delivery) => {
  const address = parseDeliveryAddress(delivery.delivery_address);
  const nextStatus = delivery.status === "assigned"
    ? "picked_up"
    : delivery.status === "picked_up" ? "delivered" : null;
  const statusLabel = statusLabels[delivery.status] || "Unknown status";
  const actionLabel = actionLabels[nextStatus] || "Update delivery";
  const orderId = String(delivery.order_id).slice(-6).toUpperCase();
  const total = Number(delivery.total || 0).toLocaleString(getLocale(), {
    style: "currency",
    currency: "BRL",
  });

  return `<article>
    <div class="status">${escapeHtml(translateCourier(statusLabel))}</div>
    <h2>${escapeHtml(translateCourier("Order "))}#${escapeHtml(orderId)}</h2>
    <div class="meta">${escapeHtml(address.street || translateCourier("Address not provided"))}, ${escapeHtml(address.number || translateCourier("Number not provided"))} · ${escapeHtml(address.city || "")}</div>
    <div class="meta">${escapeHtml(translateCourier("Total"))}: ${escapeHtml(total)}</div>
    ${nextStatus ? `<div class="actions"><button data-id="${escapeHtml(delivery.id)}" data-status="${nextStatus}">${escapeHtml(translateCourier(actionLabel))}</button><button data-id="${escapeHtml(delivery.id)}" data-status="failed">${escapeHtml(translateCourier("Report delivery issue"))}</button></div>` : ""}
  </article>`;
};

const loadDeliveries = async () => {
  const token = getToken();
  const session = sessionVersion;
  const load = ++loadVersion;
  const isCurrent = () => session === sessionVersion && load === loadVersion && token === getToken();
  if (!token) {
    elements.deliveries.innerHTML = "";
    return;
  }

  try {
    const response = await fetch(`${API_BASE_URL}/courier/deliveries`, {
      headers: { Accept: "application/json", "X-Courier-Token": token },
      signal: AbortSignal.timeout(10000),
    });
    const data = await parseResponse(response);
    if (!isCurrent()) return;
    elements.message.textContent = `${translateCourier("Courier: ")}${data.courier.name}`;
    elements.deliveries.innerHTML = data.deliveries.length
      ? data.deliveries.map(renderDelivery).join("")
      : `<p>${escapeHtml(translateCourier("No deliveries assigned."))}</p>`;
    return true;
  } catch (error) {
    if (!isCurrent()) return;
    elements.message.textContent = translateCourier(error.message);
    elements.deliveries.innerHTML = "";
    return false;
  }
};

applyCourierTranslations();

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  sessionVersion += 1;
  elements.deliveries.innerHTML = "";
  elements.message.textContent = "";
  localStorage.setItem(tokenKey, elements.tokenInput.value.trim());
  elements.tokenInput.value = "";
  void loadDeliveries();
});

elements.clearToken.addEventListener("click", () => {
  sessionVersion += 1;
  localStorage.removeItem(tokenKey);
  elements.deliveries.innerHTML = "";
  elements.message.textContent = translateCourier("Token removed from this device");
});

elements.sendLocation.addEventListener("click", () => {
  const token = getToken();
  const session = sessionVersion;
  if (!token) {
    elements.message.textContent = translateCourier("Could not access deliveries");
    return;
  }
  if (!navigator.geolocation) {
    elements.message.textContent = translateCourier("Location is unavailable on this device");
    return;
  }

  elements.message.textContent = translateCourier("Requesting location");
  navigator.geolocation.getCurrentPosition(async ({ coords }) => {
    if (session !== sessionVersion || token !== getToken()) return;
    try {
      const response = await fetch(`${API_BASE_URL}/courier/location`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Courier-Token": token },
        body: JSON.stringify({
          latitude: Number(coords.latitude.toFixed(7)),
          longitude: Number(coords.longitude.toFixed(7)),
          accuracy_m: Number(coords.accuracy.toFixed(2)),
        }),
      });
      await parseResponse(response);
      if (session !== sessionVersion || token !== getToken()) return;
      elements.message.textContent = translateCourier("Location sent");
    } catch (error) {
      if (session !== sessionVersion || token !== getToken()) return;
      elements.message.textContent = translateCourier(error.message);
    }
  }, (error) => {
    if (session !== sessionVersion || token !== getToken()) return;
    elements.message.textContent = error.message
      ? translateCourier(error.message)
      : translateCourier("Could not get your location");
  }, { enableHighAccuracy: true, maximumAge: 30000, timeout: 10000 });
});

elements.deliveries.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-id]");
  if (!button) return;

  const token = getToken();
  const session = sessionVersion;
  if (!token || deliveryUpdateInProgress) return;
  let failureReason;
  if (button.dataset.status === "failed") {
    failureReason = window.prompt(translateCourier("Describe the delivery issue Optional maximum 500 characters"), "");
    if (failureReason === null) return;
    if (failureReason.length > 500) { elements.message.textContent = translateCourier("Delivery issue reason must be at most 500 characters"); return; }
  }
  deliveryUpdateInProgress = true;
  loadVersion += 1;
  button.disabled = true;
  try {
    const response = await fetch(`${API_BASE_URL}/courier/deliveries/${button.dataset.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-Courier-Token": token },
      body: JSON.stringify({ status: button.dataset.status, ...(failureReason === undefined ? {} : { failure_reason: failureReason.trim() }) }),
      signal: AbortSignal.timeout(10000),
    });
    await parseResponse(response);
    if (session !== sessionVersion || token !== getToken()) return;
    await loadDeliveries();
  } catch (error) {
    if (session !== sessionVersion || token !== getToken()) return;
    const refreshed = await loadDeliveries();
    if (session !== sessionVersion || token !== getToken()) return;
    const detail = refreshed ? "" : elements.message.textContent;
    elements.message.textContent = translateCourier(refreshed
      ? "Could not confirm the update Check the refreshed deliveries before trying again"
      : "Could not confirm the update Reconnect and check your deliveries before trying again") + (detail ? ` ${detail}` : "");
  } finally {
    deliveryUpdateInProgress = false;
  }
});

window.addEventListener("storage", (event) => {
  if (event.key !== tokenKey && event.key !== null) return;
  sessionVersion += 1;
  elements.deliveries.innerHTML = "";
  elements.message.textContent = "";
  void loadDeliveries();
});

const refreshVisibleDeliveries = async () => {
  if (document.visibilityState !== "visible" || !getToken() || deliveryUpdateInProgress || backgroundRefreshInProgress) return;
  backgroundRefreshInProgress = true;
  try { await loadDeliveries(); }
  finally { backgroundRefreshInProgress = false; }
};

document.addEventListener("visibilitychange", () => { void refreshVisibleDeliveries(); });
window.setInterval(() => { void refreshVisibleDeliveries(); }, 30000);

void loadDeliveries();
