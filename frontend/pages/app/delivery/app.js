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
let appShellReady = false;
let couriers = [];

const statusLabels = {
  requested: "Aguardando entregador",
  assigned: "Aguardando coleta",
  picked_up: "Em trânsito",
  delivered: "Entregue",
  cancelled: "Cancelada",
  failed: "Entrega com problema",
};
const nextStatus = {
  assigned: { value: "picked_up", label: "Saiu para entrega" },
  picked_up: { value: "delivered", label: "Concluir entrega" },
};

const setMessage = (element, message, type = "success") => {
  element.textContent = message ? translate(message) : "";
  element.classList.toggle("is-error", type === "error");
  element.classList.toggle("is-success", type === "success" && Boolean(message));
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
    .join(", ") || translate("Endereço não informado");
};

const renderCouriers = (couriers) => {
  courierList.setAttribute("aria-busy", "false");
  if (!couriers.length) {
    courierList.innerHTML = renderEmpty("Nenhum entregador cadastrado");
    return;
  }

  courierList.innerHTML = couriers.map((courier) => `
    <article class="courier-entry">
      <strong>${escapeHtml(courier.name)}</strong>
      ${courier.phone ? `<span>${escapeHtml(courier.phone)}</span>` : ""}
    </article>
  `).join("");
};

const renderDeliveries = (deliveries) => {
  deliveryList.setAttribute("aria-busy", "false");
  if (!deliveries.length) {
    deliveryList.innerHTML = renderEmpty("Nenhuma entrega registrada");
    return;
  }

  deliveryList.innerHTML = deliveries.map((delivery) => {
    const status = statusLabels[delivery.status] ? delivery.status : "unknown";
    const label = translate(statusLabels[status] || "Situação desconhecida");
    const next = nextStatus[delivery.status];
    const orderNumber = String(delivery.order_id || "").slice(-6).toUpperCase() || "—";
    const courierDetail = delivery.status === "requested"
      ? ""
      : `<p class="delivery-card__courier">${translate("Entregador: ")}${escapeHtml(delivery.courier_name || translate("Não atribuído"))}</p>`;
    const assignmentControls = delivery.status === "requested"
      ? couriers.length
        ? `<div class="delivery-assignment"><label for="courier-${escapeHtml(delivery.id)}">${translate("Entregador")}</label><select id="courier-${escapeHtml(delivery.id)}" data-courier-for-delivery><option value="">${translate("Selecione um entregador")}</option>${couriers.map((courier) => `<option value="${escapeHtml(courier.id)}">${escapeHtml(courier.name)}</option>`).join("")}</select><button class="btn btn--primary" data-assign-delivery="${escapeHtml(delivery.id)}" data-order-id="${escapeHtml(delivery.order_id)}" type="button" disabled>${translate("Atribuir e iniciar entrega")}</button></div>`
        : `<p class="delivery-card__courier">${translate("Cadastre um entregador para iniciar esta entrega.")}</p>`
      : "";

    return `
      <article class="operation-card delivery-card delivery-card--${status}">
        <div class="operation-card__head delivery-card__head">
          <strong>${translate("Pedido ")}${escapeHtml(orderNumber)}</strong>
          <span class="operation-card__status operation-card__status--${status}">${label}</span>
        </div>
        <p class="operation-card__meta delivery-card__address">${formatAddress(delivery)}</p>
        ${courierDetail}
        ${assignmentControls}
        ${next ? `
          <div class="operation-card__actions delivery-actions">
            <button
              class="btn btn--primary"
              data-delivery-id="${escapeHtml(delivery.id)}"
              data-next-status="${next.value}"
              type="button"
            >${translate(next.label)}</button>
          </div>
        ` : ""}
      </article>
    `;
  }).join("");
};

const load = async () => {
  courierList.setAttribute("aria-busy", "true");
  deliveryList.setAttribute("aria-busy", "true");
  const results = await Promise.allSettled([
      apiRequest(`/businesses/${businessId}/couriers`),
      apiRequest(`/businesses/${businessId}/deliveries`),
  ]);
  const [courierResult, deliveryResult] = results;
  if (courierResult.status === "fulfilled") {
    couriers = Array.isArray(courierResult.value.couriers) ? courierResult.value.couriers : [];
    renderCouriers(couriers);
  } else {
    couriers = [];
    courierList.setAttribute("aria-busy", "false");
    courierList.innerHTML = `<div class="operation-empty" role="alert"><p>${translate("Não foi possível carregar os entregadores.")}</p><button class="btn btn--secondary" type="button" data-delivery-retry>${translate("Tentar novamente")}</button></div>`;
  }
  if (deliveryResult.status === "fulfilled") {
    const deliveries = Array.isArray(deliveryResult.value.deliveries) ? deliveryResult.value.deliveries : [];
    renderDeliveries(deliveries);
  } else {
    deliveryList.setAttribute("aria-busy", "false");
    deliveryList.innerHTML = `<div class="operation-empty" role="alert"><p>${translate("Não foi possível carregar as entregas.")}</p><button class="btn btn--secondary" type="button" data-delivery-retry>${translate("Tentar novamente")}</button></div>`;
  }
  return courierResult.status === "fulfilled" && deliveryResult.status === "fulfilled";
};

document.querySelector("main").addEventListener("click", async (event) => {
  if (!event.target.closest("[data-delivery-retry]")) return;
  if (!appShellReady) await start();
  else await load();
});

deliveryList.addEventListener("change", (event) => {
  if (!event.target.matches("[data-courier-for-delivery]")) return;
  const card = event.target.closest(".delivery-card");
  const button = card?.querySelector("[data-assign-delivery]");
  if (button) button.disabled = !event.target.value;
});

courierForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type='submit']");
  const name = document.getElementById("courierName").value.trim();
  if (!name) {
    document.getElementById("courierName").focus();
    setMessage(courierMessage, "Informe o nome do entregador", "error");
    return;
  }

  button.disabled = true;
  setMessage(courierMessage, "");

  try {
    await apiRequest(`/businesses/${businessId}/couriers`, {
      method: "POST",
      body: {
        name,
        phone: document.getElementById("courierPhone").value.trim(),
      },
    });
    form.reset();
    setMessage(courierMessage, "Entregador cadastrado");
    await load();
  } catch (error) {
    setMessage(courierMessage, "Não foi possível cadastrar o entregador", "error");
  } finally {
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
      setMessage(deliveryMessage, "Entrega atribuída");
      await load();
    } catch (error) {
      assignButton.disabled = false;
      setMessage(deliveryMessage, "Não foi possível atribuir a entrega", "error");
    }
    return;
  }

  const button = event.target.closest("[data-delivery-id]");
  if (!button || button.disabled) return;

  button.disabled = true;
  setMessage(deliveryMessage, "");

  try {
    await apiRequest(`/businesses/${businessId}/deliveries/${button.dataset.deliveryId}`, {
      method: "PATCH",
      body: { status: button.dataset.nextStatus },
    });
    setMessage(deliveryMessage, "Entrega atualizada");
    await load();
  } catch (error) {
    button.disabled = false;
    setMessage(deliveryMessage, "Não foi possível atualizar a entrega", "error");
  }
});

const start = async () => {
  deliveryLoadRetry.hidden = true;
  deliveryLoadRetry.disabled = true;
  deliveryLoadError.hidden = true;
  try {
    if (!appShellReady) {
      await initAppShell({ activeNav: "delivery" });
      appShellReady = true;
    }
    await load();
  } catch (error) {
    deliveryLoadError.textContent = translate("Não foi possível abrir as entregas");
    deliveryLoadError.hidden = false;
    deliveryLoadRetry.hidden = false;
  } finally {
    deliveryLoadRetry.disabled = false;
  }
};

deliveryLoadRetry.addEventListener("click", () => void start());
void start();
