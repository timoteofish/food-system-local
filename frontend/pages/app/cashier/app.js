import { escapeHtml, formatPrice, formatTime } from "../../../shared/utils/utils.js";
import { initAppShell } from "../../../shared/ui/ui.js";
import { initCalendarPanel } from "./calendar-id/index.js";
import { loadCashierData, updateOrderStatusRemote } from "../../../shared/auth/auth.js";

const log = document.getElementById("cashLog");
const entriesTotal = document.getElementById("entriesTotal");
const exitsTotal = document.getElementById("exitsTotal");
const balanceTotal = document.getElementById("balanceTotal");
const searchInput = document.getElementById("cashSearch");
const dateInput = document.getElementById("cashDateSearch");
const dateToggle = document.getElementById("cashDateToggle");

let searchQuery = "";
let dateQuery = "";
let orders = [];
let movements = [];
let stats = {
  entriesTotal: 0,
  exitsTotal: 0,
  cashBalance: 0,
};

const formatDate = (date = new Date()) =>
  new Date(date).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

const normalizeDateValue = (date = new Date()) => {
  const parsed = new Date(date);
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const getOrderCode = (order) =>
  String(order.orderCode || order.order_code || order.order_number || order.id || "pedido")
    .slice(-6)
    .toUpperCase();

const getPendingCounterPayments = () =>
  orders.filter(
    (order) =>
      order.paymentMethod === "dinheiro_balcao" &&
      order.paymentStatus !== "paid"
  );

const renderSummary = () => {
  entriesTotal.textContent = formatPrice(stats.entriesTotal);
  exitsTotal.textContent = formatPrice(stats.exitsTotal);
  balanceTotal.textContent = formatPrice(stats.cashBalance);
};

const render = () => {
  const query = searchQuery.trim().toLowerCase();
  const pendingPayments = getPendingCounterPayments().filter((order) => {
    const code = getOrderCode(order).toLowerCase();
    const textMatch =
      !query ||
      code.includes(query) ||
      order.customerName?.toLowerCase().includes(query) ||
      order.tableName?.toLowerCase().includes(query) ||
      formatPrice(order.total).toLowerCase().includes(query);
    const dateMatch = !dateQuery || normalizeDateValue(order.createdAt) === dateQuery;
    return textMatch && dateMatch;
  });
  const visibleMovements = movements.filter((item) => {
    const textMatch =
      !query ||
      item.label?.toLowerCase().includes(query) ||
      formatPrice(item.value).toLowerCase().includes(query) ||
      formatDate(item.createdAt || item.created_at).toLowerCase().includes(query);
    const dateMatch = !dateQuery || normalizeDateValue(item.createdAt || item.created_at) === dateQuery;
    return textMatch && dateMatch;
  });

  const pendingHtml = pendingPayments
    .map(
      (order) => `
      <div class="cash-row cash-row--pending">
        <div>
          <strong>Código ${escapeHtml(getOrderCode(order))}</strong><br>
          <span>${escapeHtml(order.customerName || "Cliente")} • ${escapeHtml(order.tableName || "Mesa")}</span>
        </div>
        <div class="cash-row__actions">
          <strong>${escapeHtml(formatPrice(order.total || 0))}</strong>
          <button class="btn btn--secondary" type="button" data-pay-order="${escapeHtml(order.id)}">Registrar pagamento</button>
        </div>
      </div>
    `
    )
    .join("");

  const movementHtml = visibleMovements.length
    ? visibleMovements
        .map(
          (item) => `
      <div class="cash-row">
        <div>
          <strong>${escapeHtml(item.label)}</strong><br>
          <span>${escapeHtml(formatDate(item.createdAt || item.created_at))} • ${escapeHtml(formatTime(item.createdAt || item.created_at))}</span>
        </div>
        <strong class="${item.type === "exit" ? "cash-row--exit" : "cash-row--entry"}">
          ${item.type === "exit" ? "- " : ""}${escapeHtml(formatPrice(item.value))}
        </strong>
      </div>
    `
        )
        .join("")
    : "";

  log.innerHTML =
    pendingHtml ||
    movementHtml
      ? pendingHtml + movementHtml
      : `<div class="cash-empty">Nenhum movimento registrado ainda.</div>`;

  renderSummary();
};

searchInput?.addEventListener("input", (event) => {
  searchQuery = event.target.value || "";
  render();
});

dateInput?.addEventListener("change", (event) => {
  applyDateFilter(event.target.value || "");
});

function applyDateFilter(value) {
  dateQuery = value;
  if (dateInput) dateInput.value = value;
  dateToggle?.classList.toggle("is-active", Boolean(value));
  dateToggle?.setAttribute("aria-label", value ? "Alterar ou remover filtro de data" : "Filtrar por data");
  render();
};

const calendarPanel = initCalendarPanel({
  onSelect: applyDateFilter,
  onClear: () => applyDateFilter(""),
});

dateToggle?.addEventListener("click", () => {
  calendarPanel.open(dateQuery);
});

dateInput?.addEventListener("click", (event) => {
  event.preventDefault();
  calendarPanel.open(dateQuery);
});

dateInput?.setAttribute("max", normalizeDateValue(new Date()));

log?.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-pay-order]");
  if (!button) return;

  const order = orders.find((item) => item.id === button.dataset.payOrder);
  if (!order) return;

  button.disabled = true;
  await updateOrderStatusRemote(order.id, "completed");
  await refresh();
});

const refresh = async () => {
  try {
    const data = await loadCashierData();
    orders = data.orders;
    movements = data.movements;
    stats = data.stats;
    render();
  } catch (error) {
    log.innerHTML = `<div class="cash-empty">${escapeHtml(error.message || "Não foi possível carregar o caixa.")}</div>`;
  }
};

(async () => {
  await initAppShell({ activeNav: "cashier" });
  await refresh();
})();
