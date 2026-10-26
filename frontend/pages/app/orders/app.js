import { getLanguage, getLocale, translate } from "../../../shared/i18n/i18n.js";
import { escapeHtml, formatOrderLocation, formatPrice } from "../../../shared/utils/utils.js";
import { initAppShell } from "../../../shared/ui/ui.js";
import { loadOrdersRemote, updateOrderStatusRemote } from "../../../shared/features/menu/index.js";

const AUTO_REFRESH_INTERVAL_MS = 7000;
let refreshInProgress = false;
let hasLoadedOrders = false;

let orders = [];
let activeFilter = "active";

const ACTIVE_STATUSES = ["new", "preparing", "ready"];
const mobileOrdersQuery = window.matchMedia("(max-width: 767px)");
let appShellInitialized = false;
let refreshTimerStarted = false;

const formatDateTime = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return translate("Horário indisponível");
  return date.toLocaleString(getLocale(), {
    hour: "2-digit",
    minute: "2-digit",
  });
};

const getCustomerName = (order) =>
  order.customerName ||
  order.customer_name ||
  order.customer?.name ||
  translate("Cliente balcão");

const getOrderLocation = (order) => {
  const location = order.tableName || order.table_name || order.table?.name || order.table || order.notes;
  const formattedLocation = formatOrderLocation(location);
  return !formattedLocation || formattedLocation === "Mesa não informada"
    ? translate("Local não informado")
    : formattedLocation;
};

const getNormalizedOrderLocation = (order) => getOrderLocation(order).trim().toLowerCase();

const getOrderItemsLabel = (order) => {
  if (!Array.isArray(order.items) || !order.items.length) {
    return translate("Itens do pedido indisponíveis");
  }

  return order.items
    .map((item) => {
      const quantity = Number(item.quantity || 1);
      const name =
        item.name ||
        item.product_name ||
        item.product?.name ||
        item.title ||
        translate("Item");
      return `${quantity}x ${name}`;
    })
    .join(" · ");
};

const getOrderCode = (order) =>
  String(order.orderCode || order.order_code || order.order_number || order.id || translate("pedido"))
    .slice(-6)
    .toUpperCase();

const getStatusLabel = (status) => {
  const labels = { new: "Novo", preparing: "Em preparo", ready: "Pronto", completed: "Concluído", cancelled: "Cancelado" };
  return translate(labels[status] || "Novo");
};

const getStatusClass = (status) => {
  if (status === "preparing") return "is-preparing";
  if (status === "ready") return "is-ready";
  if (status === "completed") return "is-completed";
  if (status === "cancelled") return "is-cancelled";
  return "is-new";
};

const getStatusToneLabel = (status) => {
  if (status === "preparing") return translate("Em preparo");
  if (status === "ready") return translate("Pedido pronto");
  return translate("Aguardando preparo");
};

const getOrderActions = (order) => {
  const orderId = escapeHtml(order.id);
  const rejectButton = `<button class="orders-card__action orders-card__action--danger" type="button" data-order-action="cancelled" data-order-id="${orderId}">${translate("Cancelar")}</button>`;
  if (order.status === "new") {
    return `${rejectButton}<button class="orders-card__action" type="button" data-order-action="preparing" data-order-id="${orderId}">${translate("Iniciar preparo")}</button>`;
  }
  if (order.status === "preparing") {
    return `${rejectButton}<button class="orders-card__action" type="button" data-order-action="ready" data-order-id="${orderId}">${translate("Marcar como pronto")}</button>`;
  }
  if (order.status === "ready") {
    return `${rejectButton}<button class="orders-card__action" type="button" data-order-action="completed" data-order-id="${orderId}">${translate("Concluir pedido")}</button>`;
  }
  return "";
};

const isActiveOrder = (order) => ACTIVE_STATUSES.includes(order.status);

const groupOrdersByLocation = (list) => {
  const groups = new Map();

  list.forEach((order) => {
    const key = getNormalizedOrderLocation(order);
    const current = groups.get(key) || {
      key,
      location: getOrderLocation(order),
      orders: [],
    };

    current.orders.push(order);
    groups.set(key, current);
  });

  return Array.from(groups.values()).sort((left, right) =>
    left.location.localeCompare(right.location, getLocale(), { numeric: true, sensitivity: "base" })
  );
};

const getVisibleOrders = (list) => {
  if (activeFilter === "active") {
    return list.filter(isActiveOrder);
  }

  return list.filter((order) => order.status === activeFilter);
};

const getLocationStageSummary = (orders) => {
  const hasReady = orders.some((order) => order.status === "ready");
  if (hasReady) return "ready";

  const hasPreparing = orders.some((order) => order.status === "preparing");
  if (hasPreparing) return "preparing";

  return "new";
};

const createOrderCard = (order) => `
  <article class="orders-card ${getStatusClass(order.status)}">
    <div class="orders-card__head">
      <span>${translate("Pedido")}</span>
      <strong>#${escapeHtml(getOrderCode(order))}</strong>
    </div>
    <div class="orders-card__info">
      <span>${translate("Cliente")}</span>
      <strong>${escapeHtml(getCustomerName(order))}</strong>
    </div>
    <div class="orders-card__info">
      <span>${translate("Itens")}</span>
      <p>${escapeHtml(getOrderItemsLabel(order))}</p>
    </div>
    <div class="orders-card__meta">
      <span>${escapeHtml(formatDateTime(order.createdAt))}</span>
      <strong>${escapeHtml(formatPrice(order.total || 0))}</strong>
    </div>
    <div class="orders-card__footer">
      <small>${escapeHtml(getStatusLabel(order.status))}</small>
      <div class="orders-card__actions">${getOrderActions(order)}</div>
    </div>
  </article>
`;

const createLocationSection = (group) => {
  const stage = getLocationStageSummary(group.orders);
  const total = group.orders.reduce((sum, order) => sum + Number(order.total || 0), 0);

  return `
    <section class="orders-table ${getStatusClass(stage)}">
      <div class="orders-table__head">
        <div class="orders-table__identity">
          <span class="orders-table__label">${translate("Local")}</span>
          <strong>${escapeHtml(group.location)}</strong>
          <small>${escapeHtml(getStatusToneLabel(stage))}</small>
        </div>
        <div class="orders-table__meta">
          <span>${group.orders.length} ${translate(group.orders.length === 1 ? "pedido" : "pedidos")}</span>
          <strong>${escapeHtml(formatPrice(total))}</strong>
        </div>
      </div>
      <div class="orders-table__orders">
        ${group.orders.map((order) => createOrderCard(order)).join("")}
      </div>
    </section>
  `;
};

const renderSummary = (list) => {
  const counts = {
    active: groupOrdersByLocation(list.filter(isActiveOrder)).length,
    preparing: list.filter((order) => order.status === "preparing").length,
    ready: list.filter((order) => order.status === "ready").length,
  };

  document.querySelectorAll("[data-orders-summary]").forEach((element) => {
    const key = element.dataset.ordersSummary;
    element.textContent = String(counts[key] || 0);
  });
};

const renderOrders = (orders) => {
  const list = document.getElementById("ordersList");
  if (!list) return;
  list.setAttribute("aria-busy", "false");
  document.querySelectorAll("[data-order-filter]").forEach((button) => {
    button.disabled = false;
  });

  const sorted = orders
    .slice()
    .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
  const visibleOrders = getVisibleOrders(sorted);
  const groupedOrders = groupOrdersByLocation(visibleOrders);
  const heading = document.getElementById("ordersHeadingTitle");
  if (heading) heading.textContent = translate(mobileOrdersQuery.matches ? "Pedidos ativos" : "Pedidos por local");

  renderSummary(sorted);

  if (groupedOrders.length) {
    list.innerHTML = groupedOrders.map((group) => createLocationSection(group)).join("");
    return;
  }

  const emptyState = mobileOrdersQuery.matches
    ? { title: translate("Nenhum pedido na fila de preparo"), detail: translate("Novos pedidos aparecerão aqui para a equipe iniciar o preparo") }
    : activeFilter !== "active"
      ? { title: translate("Sem pedidos nesta etapa"), detail: translate("Os pedidos aparecerão aqui quando avançarem para esta etapa") }
      : { title: translate("Nenhum local com pedidos no momento"), detail: translate("Novos pedidos aparecerão aqui quando chegarem") };
  list.innerHTML = `<article class="orders-empty"><strong>${emptyState.title}</strong><p>${emptyState.detail}</p></article>`;
};

const refreshOrders = async () => {
  if (refreshInProgress || document.hidden) return;
  refreshInProgress = true;
  if (!hasLoadedOrders) {
    const list = document.getElementById("ordersList");
    if (list) {
      list.setAttribute("aria-busy", "true");
      list.innerHTML = `<article class="orders-empty" role="status"><strong>${translate("Carregando pedidos")}</strong></article>`;
    }
  }
  try {
    orders = await loadOrdersRemote();
    hasLoadedOrders = true;
    const feedback = document.getElementById("ordersFeedback");
    if (feedback) {
      feedback.hidden = true;
      feedback.textContent = "";
      feedback.removeAttribute("data-state");
    }
    renderOrders(orders);
  } catch {
    const feedback = document.getElementById("ordersFeedback");
    if (feedback && hasLoadedOrders) {
      feedback.textContent = translate("Não foi possível atualizar os pedidos Verifique a conexão e tente novamente");
      feedback.dataset.state = "error";
      feedback.hidden = false;
    } else if (feedback) {
      feedback.hidden = true;
    }
    if (!hasLoadedOrders) {
      const list = document.getElementById("ordersList");
      if (list) {
        list.setAttribute("aria-busy", "false");
        list.innerHTML = `<article class="orders-empty" role="alert"><strong>${translate("Os pedidos não foram carregados")}</strong><p>${translate("Verifique a conexão e tente novamente.")}</p><button class="btn btn--secondary" type="button" data-orders-retry>${translate("Tentar novamente")}</button></article>`;
      }
    }
  } finally {
    refreshInProgress = false;
  }
};

const initializeOrders = async () => {
  try {
    if (!appShellInitialized) {
      await initAppShell({ activeNav: "orders" });
      appShellInitialized = true;
    }
    await refreshOrders();
    if (!refreshTimerStarted) {
      window.setInterval(refreshOrders, AUTO_REFRESH_INTERVAL_MS);
      refreshTimerStarted = true;
    }
  } catch {
    const list = document.getElementById("ordersList");
    if (list) {
      list.setAttribute("aria-busy", "false");
      list.innerHTML = `<article class="orders-empty" role="alert"><strong>${translate("Não foi possível abrir os pedidos.")}</strong><button class="btn btn--secondary" type="button" data-orders-retry>${translate("Tentar novamente")}</button></article>`;
    }
  }
};

void initializeOrders();

mobileOrdersQuery.addEventListener("change", () => {
  if (hasLoadedOrders) renderOrders(orders);
});

document.addEventListener("click", async (event) => {
  if (event.target.closest("[data-orders-retry]")) {
    if (!appShellInitialized) await initializeOrders();
    else await refreshOrders();
    return;
  }
  const filterButton = event.target.closest("[data-order-filter]");
  if (filterButton) {
    activeFilter = filterButton.dataset.orderFilter || "all";
    document.querySelectorAll("[data-order-filter]").forEach((button) => {
      const isActive = button === filterButton;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });
    renderOrders(orders);
    return;
  }

  const actionButton = event.target.closest("[data-order-action][data-order-id]");
  if (!actionButton) return;

  const orderId = actionButton.dataset.orderId;
  const nextStatus = actionButton.dataset.orderAction;
  if (!orderId || !nextStatus) return;

  if (nextStatus === "cancelled") {
    const confirmation = translate("Cancelar este pedido?");
    if (!window.confirm(confirmation)) return;
  }

  actionButton.disabled = true;
  try {
    await updateOrderStatusRemote(orderId, nextStatus);
    await refreshOrders();
  } catch (error) {
    const feedback = document.getElementById("ordersFeedback");
    if (feedback) {
      feedback.textContent = translate("Não foi possível atualizar o pedido Tente novamente");
      feedback.dataset.state = "error";
      feedback.hidden = false;
    }
  } finally {
    actionButton.disabled = false;
  }
})();
