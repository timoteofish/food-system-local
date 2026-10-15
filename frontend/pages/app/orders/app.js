import { escapeHtml, formatPrice } from "../../../shared/utils/utils.js";
import { initAppShell } from "../../../shared/ui/ui.js";
import { loadOrdersRemote, updateOrderStatusRemote } from "../../../shared/features/menu/index.js";

const AUTO_REFRESH_INTERVAL_MS = 7000;

let orders = [];
let activeFilter = "active";

const ACTIVE_STATUSES = ["new", "preparing", "ready"];
const MOBILE_PREPARATION_STATUSES = ["new", "preparing"];
const mobileOrdersQuery = window.matchMedia("(max-width: 767px)");

const formatDateTime = (value) =>
  new Date(value).toLocaleString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });

const getCustomerName = (order) =>
  order.customerName ||
  order.customer_name ||
  order.customer?.name ||
  "Cliente balcão";

const getTableName = (order) =>
  order.tableName ||
  order.table_name ||
  order.table ||
  order.notes ||
  "Mesa não informada";

const getNormalizedTableName = (order) => getTableName(order).trim().toLowerCase();

const getOrderItemsLabel = (order) => {
  if (!Array.isArray(order.items) || !order.items.length) {
    return "Pedido sem itens detalhados";
  }

  return order.items
    .map((item) => {
      const quantity = Number(item.quantity || 1);
      const name =
        item.name ||
        item.product_name ||
        item.product?.name ||
        item.title ||
        "Item";
      return `${quantity}x ${name}`;
    })
    .join(", ");
};

const getOrderCode = (order) =>
  String(order.orderCode || order.order_code || order.order_number || order.id || "pedido")
    .slice(-6)
    .toUpperCase();

const getStatusLabel = (status) => {
  if (status === "new") return "Novo pedido";
  if (status === "preparing") return "Em preparo";
  if (status === "ready") return "Pronto para entrega";
  if (status === "completed") return "Concluído";
  if (status === "cancelled") return "Cancelado";
  return "Novo pedido";
};

const getStatusClass = (status) => {
  if (status === "preparing") return "is-preparing";
  if (status === "ready") return "is-ready";
  if (status === "completed") return "is-completed";
  if (status === "cancelled") return "is-cancelled";
  return "is-new";
};

const getStatusToneLabel = (status) => {
  if (status === "preparing") return "Cozinha em andamento";
  if (status === "ready") return "Liberado para entrega";
  return "Aguardando preparo";
};

const getOrderActions = (order) => {
  const orderId = escapeHtml(order.id);
  const rejectButton = `<button class="orders-card__action orders-card__action--danger" type="button" data-order-action="cancelled" data-order-id="${orderId}">Recusar</button>`;
  if (order.status === "new") {
    return `${rejectButton}<button class="orders-card__action" type="button" data-order-action="preparing" data-order-id="${orderId}">Iniciar preparo</button>`;
  }
  if (order.status === "preparing") {
    return `${rejectButton}<button class="orders-card__action" type="button" data-order-action="ready" data-order-id="${orderId}">Marcar como pronto</button>`;
  }
  if (order.status === "ready") {
    return `${rejectButton}<button class="orders-card__action" type="button" data-order-action="completed" data-order-id="${orderId}">Concluir pedido</button>`;
  }
  return "";
};

const isActiveOrder = (order) => ACTIVE_STATUSES.includes(order.status);

const groupOrdersByTable = (list) => {
  const groups = new Map();

  list.forEach((order) => {
    const key = getNormalizedTableName(order);
    const current = groups.get(key) || {
      key,
      tableName: getTableName(order),
      orders: [],
    };

    current.orders.push(order);
    groups.set(key, current);
  });

  return Array.from(groups.values()).sort((left, right) =>
    left.tableName.localeCompare(right.tableName, "pt-BR", { numeric: true, sensitivity: "base" })
  );
};

const getVisibleOrders = (list) => {
  if (mobileOrdersQuery.matches) {
    return list.filter((order) => MOBILE_PREPARATION_STATUSES.includes(order.status));
  }

  if (activeFilter === "active") {
    return list.filter(isActiveOrder);
  }

  return list.filter((order) => order.status === activeFilter);
};

const getTableStageSummary = (orders) => {
  const hasReady = orders.some((order) => order.status === "ready");
  if (hasReady) return "ready";

  const hasPreparing = orders.some((order) => order.status === "preparing");
  if (hasPreparing) return "preparing";

  return "new";
};

const createOrderCard = (order) => `
  <article class="orders-card ${getStatusClass(order.status)}">
    <div class="orders-card__head">
      <span>Pedido</span>
      <strong>#${escapeHtml(getOrderCode(order))}</strong>
    </div>
    <div class="orders-card__info">
      <span>Cliente</span>
      <strong>${escapeHtml(getCustomerName(order))}</strong>
    </div>
    <div class="orders-card__info">
      <span>Pedido</span>
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

const createTableSection = (group) => {
  const stage = getTableStageSummary(group.orders);
  const total = group.orders.reduce((sum, order) => sum + Number(order.total || 0), 0);

  return `
    <section class="orders-table ${getStatusClass(stage)}">
      <div class="orders-table__head">
        <div class="orders-table__identity">
          <span class="orders-table__label">Mesa</span>
          <strong>${escapeHtml(group.tableName)}</strong>
          <small>${escapeHtml(getStatusToneLabel(stage))}</small>
        </div>
        <div class="orders-table__meta">
          <span>${group.orders.length} ${group.orders.length === 1 ? "pedido" : "pedidos"}</span>
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
    active: groupOrdersByTable(list.filter(isActiveOrder)).length,
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

  const sorted = orders
    .slice()
    .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
  const visibleOrders = getVisibleOrders(sorted);
  const groupedOrders = groupOrdersByTable(visibleOrders);
  const heading = document.getElementById("ordersHeadingTitle");
  if (heading) heading.textContent = mobileOrdersQuery.matches ? "Fila de preparo" : "Acompanhamento por mesa";

  renderSummary(sorted);

  list.innerHTML = groupedOrders.length
    ? groupedOrders
        .map((group) => createTableSection(group))
        .join("")
    : `<article class="orders-empty"><strong>${mobileOrdersQuery.matches ? "Nenhum pedido aguardando preparo" : "Nenhuma mesa na operação atual"}</strong><p>${mobileOrdersQuery.matches ? "Novos pedidos aparecerão aqui para a equipe iniciar o preparo." : "Assim que uma nova mesa gerar pedido ou mudar de etapa, ela aparece aqui."}</p></article>`;
};

const refreshOrders = async () => {
  orders = await loadOrdersRemote();
  renderOrders(orders);
};

(async () => {
  await initAppShell({ activeNav: "orders" });
  await refreshOrders();
  window.setInterval(refreshOrders, AUTO_REFRESH_INTERVAL_MS);
})();

mobileOrdersQuery.addEventListener("change", () => renderOrders(orders));

document.addEventListener("click", async (event) => {
  const filterButton = event.target.closest("[data-order-filter]");
  if (filterButton) {
    activeFilter = filterButton.dataset.orderFilter || "all";
    document.querySelectorAll("[data-order-filter]").forEach((button) => {
      button.classList.toggle("is-active", button === filterButton);
    });
    renderOrders(orders);
    return;
  }

  const actionButton = event.target.closest("[data-order-action][data-order-id]");
  if (!actionButton) return;

  const orderId = actionButton.dataset.orderId;
  const nextStatus = actionButton.dataset.orderAction;
  if (!orderId || !nextStatus) return;

  actionButton.disabled = true;
  try {
    await updateOrderStatusRemote(orderId, nextStatus);
    await refreshOrders();
  } finally {
    actionButton.disabled = false;
  }
})();
