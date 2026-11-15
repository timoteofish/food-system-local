import { apiRequest } from "../../../shared/api/client.js";
import { getSession } from "../../../shared/data/storage.js";
import { escapeHtml } from "../../../shared/utils/utils.js";
import { translate } from "../../../shared/i18n/i18n.js";
import { initAppShell } from "../../../shared/ui/ui.js";

const businessId = getSession()?.businessId;
const courierList = document.getElementById("courierList");
const deliveryList = document.getElementById("deliveryList");
const courierForm = document.getElementById("courierForm");
const courierMessage = document.getElementById("courierMessage");
const deliveryMessage = document.getElementById("deliveryMessage");
const deliveryLoadError = document.getElementById("deliveryLoadError");
const deliveryLoadRetry = document.getElementById("deliveryLoadRetry");
const deliveryErrorModal = document.getElementById("deliveryErrorModal");
const deliveryErrorClose = document.getElementById("deliveryErrorClose");
const deliveryPageLoading = document.getElementById("deliveryPageLoading");
let appShellReady = false;
let couriers = [];
let courierAccessBusy = false;

const hideDeliveryError = () => {
  deliveryErrorModal.hidden = true;
  document.body.classList.remove("modal-open");
};

const showDeliveryError = () => {
  deliveryPageLoading.hidden = true;
  deliveryLoadError.textContent = translate("loadRetryError");
  deliveryLoadRetry.disabled = false;
  deliveryErrorModal.hidden = false;
  document.body.classList.add("modal-open");
  deliveryErrorClose.focus();
};

const setDeliveryLoading = (isLoading) => {
  deliveryPageLoading.hidden = !isLoading;
  if (isLoading) {
    deliveryPageLoading.querySelector("[data-delivery-loading-label]").textContent = translate("Loading");
  }
};

deliveryErrorModal.addEventListener("click", (event) => {
  if (event.target.closest("[data-close-delivery-error]")) hideDeliveryError();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !deliveryErrorModal.hidden) hideDeliveryError();
});

const statusLabels = {
  requested: "Waiting for a driver",
  assigned: "Waiting for pickup",
  picked_up: "In transit",
  delivered: "Delivered",
  cancelled: "Canceled",
  failed: "Delivery issue",
};
const nextStatus = {
  assigned: { value: "picked_up", label: "Out for delivery" },
  picked_up: { value: "delivered", label: "Complete delivery" },
};

const setMessage = (element, message, type = "success") => {
  element.textContent = message ? translate(message) : "";
  element.classList.toggle("is-error", type === "error");
  element.classList.toggle("is-success", type === "success" && Boolean(message));
};

const getCourierPublicUrl = async () => {
  let base = String(window.FOOD_SYSTEM_PUBLIC_MENU_URL || "").trim();
  if (!base) {
    try { base = await window.__TAURI__?.core?.invoke?.("public_menu_base_url") || ""; }
    catch { /* Browser development can use its current origin. */ }
  }
  try {
    const url = new URL(base || window.location.origin);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
        host === "localhost" || host.endsWith(".localhost") || host === "[::1]" || host === "0.0.0.0" || /^127\./.test(host)) return "";
    return new URL("/pages/courier/index.html", url.origin).href;
  } catch { return ""; }
};

const showCourierAccess = async (access, message) => {
  if (typeof access.token !== "string" || !access.token) throw new Error("Token unavailable");
  setMessage(courierMessage, message);
  courierMessage.textContent = courierMessage.textContent.replace("$1", access.token).replace("$2", String(access.expires_in_days));
  const courierUrl = await getCourierPublicUrl();
  courierMessage.textContent += " " + (courierUrl
    ? translate("Configured driver address $1").replace("$1", courierUrl)
    : translate("Configure an HTTPS network address for access from another device"));
};

const renderEmpty = (message) => `<p class="operation-empty">${escapeHtml(translate(message))}</p>`;

const parseAddress = (value) => {
  if (!value) return {};
  if (typeof value !== "string") return value && typeof value === "object" ? value : {};
  try {
    const address = JSON.parse(value);
    return address && typeof address === "object" ? address : {};
  } catch {
    return { street: value };
  }
};

const formatAddress = (delivery) => {
  const address = parseAddress(delivery.delivery_address);
  return [address.street, address.number, address.neighborhood, address.city]
    .filter(Boolean)
    .map(escapeHtml)
    .join(", ") || translate("Address not provided");
};

const renderCouriers = (couriers) => {
  courierList.setAttribute("aria-busy", "false");
  if (!couriers.length) {
    courierList.innerHTML = renderEmpty("No drivers registered");
    return;
  }

  courierList.innerHTML = couriers.map((courier) => `
    <article class="courier-entry">
      <strong>${escapeHtml(courier.name)}</strong>
      ${courier.phone ? `<span>${escapeHtml(courier.phone)}</span>` : ""}
      ${Number(courier.active) === 1 ? `<button class="btn btn--secondary courier-entry__access" type="button" data-renew-courier="${escapeHtml(courier.id)}">${translate("Renew driver access")}</button>` : ""}
    </article>
  `).join("");
};

const renderDeliveries = (deliveries) => {
  deliveryList.setAttribute("aria-busy", "false");
  if (!deliveries.length) {
    deliveryList.innerHTML = renderEmpty("No deliveries yet");
    return;
  }

  deliveryList.innerHTML = deliveries.map((delivery) => {
    const status = statusLabels[delivery.status] ? delivery.status : "unknown";
    const label = translate(statusLabels[status] || "Unknown status");
    const next = nextStatus[delivery.status];
    const orderNumber = String(delivery.order_id || "").slice(-6).toUpperCase() || "—";
    const courierDetail = delivery.status === "requested"
      ? ""
      : `<p class="delivery-card__courier">${translate("Driver: ")}${escapeHtml(delivery.courier_name || translate("Unassigned"))}</p>`;
    const activeCouriers = couriers.filter((courier) => Number(courier.active) === 1);
    const assignmentControls = delivery.status === "requested" || (delivery.status === "failed" && Number(delivery.can_retry) === 1)
      ? activeCouriers.length
        ? `<div class="delivery-assignment"><label for="courier-${escapeHtml(delivery.id)}">${translate("Driver")}</label><select id="courier-${escapeHtml(delivery.id)}" data-courier-for-delivery><option value="">${translate("Select a driver")}</option>${activeCouriers.map((courier) => `<option value="${escapeHtml(courier.id)}">${escapeHtml(courier.name)}</option>`).join("")}</select><button class="btn btn--primary" data-assign-delivery="${escapeHtml(delivery.id)}" data-order-id="${escapeHtml(delivery.order_id)}" type="button" disabled>${translate(delivery.status === "failed" ? "Assign another delivery attempt" : "Assign and start delivery")}</button></div>`
        : `<p class="delivery-card__courier">${translate("Add a driver to start this delivery")}</p>`
      : "";

    return `
      <article class="operation-card delivery-card delivery-card--${status}">
        <div class="operation-card__head delivery-card__head">
          <strong>${translate("Order ")}${escapeHtml(orderNumber)}</strong>
          <span class="operation-card__status operation-card__status--${status}">${label}</span>
        </div>
        <p class="operation-card__meta delivery-card__address">${formatAddress(delivery)}</p>
        ${courierDetail}
        ${delivery.status === "failed" && delivery.failure_reason ? `<p class="delivery-card__courier">${escapeHtml(translate("Issue reason: "))}${escapeHtml(delivery.failure_reason)}</p>` : ""}
        ${assignmentControls}
        ${next ? `
          <div class="operation-card__actions delivery-actions">
            <button
              class="btn btn--primary"
              data-delivery-id="${escapeHtml(delivery.id)}"
              data-next-status="${next.value}"
              type="button"
            >${translate(next.label)}</button>
            <button class="btn btn--secondary" data-delivery-id="${escapeHtml(delivery.id)}" data-next-status="failed" type="button">${translate("Report delivery issue")}</button>
          </div>
        ` : ""}
      </article>
    `;
  }).join("");
};

const load = async () => {
  setDeliveryLoading(true);
  courierList.setAttribute("aria-busy", "true");
  deliveryList.setAttribute("aria-busy", "true");
  const results = await Promise.allSettled([
      apiRequest(`/businesses/${businessId}/couriers`),
      apiRequest(`/businesses/${businessId}/deliveries?view=queue`),
  ]);
  const [courierResult, deliveryResult] = results;
  let hasLoadError = false;
  if (courierResult.status === "fulfilled") {
    couriers = Array.isArray(courierResult.value.couriers) ? courierResult.value.couriers : [];
    renderCouriers(couriers);
  } else {
    couriers = [];
    courierList.setAttribute("aria-busy", "false");
    courierList.replaceChildren();
    hasLoadError = true;
  }
  if (deliveryResult.status === "fulfilled") {
    const deliveries = Array.isArray(deliveryResult.value.deliveries) ? deliveryResult.value.deliveries : [];
    renderDeliveries(deliveries);
  } else {
    deliveryList.setAttribute("aria-busy", "false");
    deliveryList.replaceChildren();
    hasLoadError = true;
  }
  if (hasLoadError) showDeliveryError();
  else setDeliveryLoading(false);
  return courierResult.status === "fulfilled" && deliveryResult.status === "fulfilled";
};

deliveryList.addEventListener("change", (event) => {
  if (!event.target.matches("[data-courier-for-delivery]")) return;
  const card = event.target.closest(".delivery-card");
  const button = card?.querySelector("[data-assign-delivery]");
  if (button) button.disabled = !event.target.value;
});

courierForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (courierAccessBusy) return;
  const form = event.currentTarget;
  const button = form.querySelector("button[type='submit']");
  const name = document.getElementById("courierName").value.trim();
  if (!name) {
    document.getElementById("courierName").focus();
    setMessage(courierMessage, "Enter the driver's name", "error");
    return;
  }

  button.disabled = true;
  courierAccessBusy = true;
  setMessage(courierMessage, "");

  let courierCreated = false;
  try {
    const created = await apiRequest(`/businesses/${businessId}/couriers`, {
      method: "POST",
      body: {
        name,
        phone: document.getElementById("courierPhone").value.trim(),
      },
    });
    courierCreated = true;
    form.reset();
    try {
      const access = await apiRequest(`/businesses/${businessId}/couriers/${encodeURIComponent(created.courier.id)}/token`, { method: "POST", body: {} });
      await showCourierAccess(access, "Driver added Access token $1 Valid for $2 days Copy and share privately It will not be shown again");
    } catch {
      setMessage(courierMessage, "Driver added but access token could not be issued Contact the administrator", "error");
    }
    await load();
  } catch (error) {
    if (!courierCreated) setMessage(courierMessage, "Could not confirm driver registration Check the list before trying again", "error");
  } finally {
    courierAccessBusy = false;
    button.disabled = false;
  }
});

courierList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-renew-courier]");
  if (!button || button.disabled || courierAccessBusy) return;
  const courier = couriers.find((entry) => entry.id === button.dataset.renewCourier && Number(entry.active) === 1);
  if (!courier || !window.confirm(translate("Renew access for $1 The previous token will stop working").replace("$1", courier.name))) return;
  courierAccessBusy = true;
  button.disabled = true;
  setMessage(courierMessage, "");
  try {
    const access = await apiRequest(`/businesses/${businessId}/couriers/${encodeURIComponent(courier.id)}/token`, { method: "POST", body: {} });
    await showCourierAccess(access, "Driver access renewed Token $1 Valid for $2 days Copy and share privately It will not be shown again");
  } catch {
    setMessage(courierMessage, "Could not confirm access renewal The previous token may no longer work Check before trying again", "error");
  } finally {
    courierAccessBusy = false;
    button.disabled = false;
  }
});

deliveryList.addEventListener("click", async (event) => {
  const assignButton = event.target.closest("[data-assign-delivery]");
  if (assignButton) {
    if (assignButton.disabled) return;
    const card = assignButton.closest(".delivery-card");
    const courierId = card?.querySelector("[data-courier-for-delivery]")?.value;
    if (!courierId) return;
    assignButton.disabled = true;
    setMessage(deliveryMessage, "");
    try {
      await apiRequest(`/businesses/${businessId}/orders/${encodeURIComponent(assignButton.dataset.orderId)}/delivery`, {
        method: "POST",
        body: { courier_id: courierId },
      });
      setMessage(deliveryMessage, "Delivery assigned");
      await load();
    } catch (error) {
      assignButton.disabled = false;
      await load();
      setMessage(deliveryMessage, "Could not confirm delivery assignment Check the queue before trying again", "error");
    }
    return;
  }

  const button = event.target.closest("[data-delivery-id]");
  if (!button || button.disabled) return;
  let failureReason;
  if (button.dataset.nextStatus === "failed") {
    failureReason = window.prompt(translate("Describe the delivery issue Optional maximum 500 characters"), "");
    if (failureReason === null) return;
    if (failureReason.length > 500) { setMessage(deliveryMessage, "Delivery issue reason must be at most 500 characters", "error"); return; }
  }

  button.disabled = true;
  setMessage(deliveryMessage, "");

  try {
    await apiRequest(`/businesses/${businessId}/deliveries/${button.dataset.deliveryId}`, {
      method: "PATCH",
      body: { status: button.dataset.nextStatus, ...(failureReason === undefined ? {} : { failure_reason: failureReason.trim() }) },
    });
    setMessage(deliveryMessage, "Delivery updated");
    await load();
  } catch (error) {
    button.disabled = false;
    await load();
    setMessage(deliveryMessage, "Could not confirm delivery update Check the queue before trying again", "error");
  }
});

const start = async () => {
  hideDeliveryError();
  setDeliveryLoading(true);
  deliveryLoadRetry.disabled = true;
  try {
    if (!appShellReady) {
      await initAppShell({ activeNav: "delivery" });
      appShellReady = true;
    }
    await load();
  } catch {
    showDeliveryError();
  } finally {
    deliveryLoadRetry.disabled = false;
  }
};

deliveryLoadRetry.addEventListener("click", () => void start());
void start();
