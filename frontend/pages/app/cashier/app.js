import { getLanguage, getLocale, translate } from "../../../shared/i18n/i18n.js";
import { escapeHtml, formatPrice, formatTime } from "../../../shared/utils/utils.js";
import { initAppShell } from "../../../shared/ui/ui.js";
import { initCalendarPanel } from "./calendar-id/index.js";
import { loadCashierData, updateOrderStatusRemote } from "../../../shared/auth/auth.js";
import {
  closeCashRegister,
  createCashMovement,
  fetchCurrentCashRegister,
  openCashRegister,
} from "../../../shared/api/client.js";
import { getSession } from "../../../shared/data/storage.js";

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
let currentRegister = null;
const businessId = getSession()?.businessId;
const registerStatus = document.getElementById("cashRegisterStatus");
const registerAction = document.getElementById("cashRegisterAction");
const registerForm = document.getElementById("cashRegisterForm");
const registerAmount = document.getElementById("cashRegisterAmount");
const registerNotes = document.getElementById("cashRegisterNotes");
const registerMessage = document.getElementById("cashRegisterMessage");
const registerAmountLabel = document.getElementById("cashRegisterAmountLabel");
const registerNotesField = document.getElementById("cashRegisterNotesField");
const movementForm = document.getElementById("movementForm");
const movementMessage = document.getElementById("movementMessage");
const movementSubmit = document.getElementById("movementSubmit");
const movementAvailability = document.getElementById("movementAvailability");
const loadMessage = document.getElementById("cashLoadMessage");
const loadRetry = document.getElementById("cashLoadRetry");
const cashSummary = document.querySelector(".cash-summary");
const actionMessage = document.getElementById("cashActionMessage");
let registerBusy = false;
let movementBusy = false;
let hasLoadedCash = false;
let refreshInProgress = false;
let appShellReady = false;

const setMessage = (element, message, state = "") => {
  if (!element) return;
  element.textContent = message;
  element.hidden = !message;
  if (state) element.dataset.state = state;
  else element.removeAttribute("data-state");
};

const renderRegister = () => {
  const open = Boolean(currentRegister);
  registerStatus.textContent = open
    ? currentRegister.opened_at ? `${translate("Aberto desde ")}${formatDate(currentRegister.opened_at)}` : translate("Aberto")
    : translate("Fechado");
  registerStatus.classList.toggle("is-open", open);
  registerStatus.classList.toggle("is-closed", !open);
  registerAction.textContent = translate(open ? "Fechar caixa" : "Abrir caixa");
  registerAction.disabled = registerBusy || !hasLoadedCash;
  registerAmountLabel.textContent = translate(open ? "Valor contado no fechamento" : "Valor inicial do caixa");
  registerNotesField.hidden = !open;
  movementSubmit.disabled = !open || movementBusy || !hasLoadedCash;
  movementAvailability.hidden = open;
  document.getElementById("cashRegisterTitle").textContent = translate(open ? "Turno em andamento" : "Iniciar turno");
  registerAmount.value = "";
  registerNotes.value = "";
};

const formatDate = (date) => {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return translate("Horário indisponível");
  return parsed.toLocaleDateString(getLocale(), {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
};

const normalizeDateValue = (date = new Date()) => {
  const parsed = new Date(date);
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const getOrderCode = (order) =>
  String(order.orderCode || order.order_code || order.order_number || order.id || translate("pedido"))
    .slice(-6)
    .toUpperCase();

const getPendingCounterPayments = () =>
  orders.filter((order) => order.paymentMethod === "dinheiro_balcao" && order.paymentStatus !== "paid");

const renderSummary = () => {
  entriesTotal.textContent = formatPrice(stats.entriesTotal);
  exitsTotal.textContent = formatPrice(stats.exitsTotal);
  balanceTotal.textContent = formatPrice(stats.cashBalance);
};

const render = () => {
  log?.setAttribute("aria-busy", "false");
  const query = searchQuery.trim().toLowerCase();
  const pendingPayments = getPendingCounterPayments().filter((order) => {
    const code = getOrderCode(order).toLowerCase();
    const textMatch =
      !query ||
      code.includes(query) ||
      String(order.customerName || "").toLowerCase().includes(query) ||
      String(order.tableName || "").toLowerCase().includes(query) ||
      formatPrice(order.total).toLowerCase().includes(query);
    const dateMatch = !dateQuery || normalizeDateValue(order.createdAt) === dateQuery;
    return textMatch && dateMatch;
  });
  const visibleMovements = movements.filter((item) => {
    const textMatch =
      !query ||
      String(item.label || "").toLowerCase().includes(query) ||
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
          <strong>${translate("Código ")}${escapeHtml(getOrderCode(order))}</strong><br>
          <span>${escapeHtml(order.customerName || translate("Cliente"))} • ${escapeHtml(order.tableName || translate("Balcão"))}</span>
        </div>
        <div class="cash-row__actions">
          <strong>${escapeHtml(formatPrice(order.total || 0))}</strong>
          <button class="btn btn--secondary" type="button" data-pay-order="${escapeHtml(order.id)}">${translate("Confirmar pagamento")}</button>
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

  if (pendingHtml || movementHtml) {
    log.innerHTML = pendingHtml + movementHtml;
  } else {
    const message = query || dateQuery
      ? "Nenhum resultado corresponde aos filtros"
      : "Nenhum movimento registrado ainda";
    log.innerHTML = `<div class="cash-empty">${translate(message)}</div>`;
  }

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
  dateToggle?.setAttribute("aria-label", translate(value ? "Alterar ou remover filtro de data" : "Filtrar por data"));
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

registerForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (registerBusy) return;
  registerBusy = true;
  registerAction.disabled = true;
  setMessage(registerMessage, "");
  try {
    const amount = Number(registerAmount.value);
    if (currentRegister) {
      const confirmation = getLanguage() === "en"
        ? `Close the register with a counted balance of ${formatPrice(amount)}?`
        : `Fechar o caixa com saldo contado de ${formatPrice(amount)}?`;
      if (!window.confirm(confirmation)) return;
      await closeCashRegister(businessId, currentRegister.id, amount, registerNotes.value.trim());
      currentRegister = null;
      renderRegister();
      setMessage(registerMessage, translate("Caixa fechado"), "success");
    } else {
      currentRegister = await openCashRegister(businessId, amount);
      renderRegister();
      setMessage(registerMessage, translate("Caixa aberto"), "success");
    }
    await refresh();
  } catch {
    setMessage(registerMessage, translate("Não foi possível atualizar o caixa Confira o valor e tente novamente"), "error");
  } finally {
    registerBusy = false;
    registerAction.disabled = !hasLoadedCash;
  }
});

movementForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (movementBusy || !currentRegister) return;
  movementBusy = true;
  movementSubmit.disabled = true;
  setMessage(movementMessage, "");
  try {
    await createCashMovement(businessId, {
      type: document.getElementById("movementType").value,
      amount: Number(document.getElementById("movementAmount").value),
      description: document.getElementById("movementDescription").value.trim(),
    });
    event.target.reset();
    await refresh();
    setMessage(movementMessage, translate("Movimentação registrada"), "success");
  } catch {
    setMessage(movementMessage, translate("Não foi possível registrar a movimentação Confira os dados e tente novamente"), "error");
  } finally {
    movementBusy = false;
    movementSubmit.disabled = !currentRegister || !hasLoadedCash;
  }
});

log?.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-pay-order]");
  if (!button) return;

  const order = orders.find((item) => item.id === button.dataset.payOrder);
  if (!order) return;
  const confirmation = getLanguage() === "en"
    ? `Confirm payment for order ${getOrderCode(order)}?`
    : `Confirmar o pagamento do pedido ${getOrderCode(order)}?`;
  if (!window.confirm(confirmation)) return;

  button.disabled = true;
  setMessage(actionMessage, "");
  try {
    await updateOrderStatusRemote(order.id, "completed");
    await refresh();
    setMessage(actionMessage, translate("Pagamento confirmado e pedido concluído"), "success");
  } catch {
    setMessage(actionMessage, translate("Não foi possível confirmar o pagamento Tente novamente"), "error");
    button.disabled = false;
  }
});

const refresh = async () => {
  if (refreshInProgress) return;
  refreshInProgress = true;
  if (!hasLoadedCash) {
    cashSummary?.setAttribute("aria-busy", "true");
    log?.setAttribute("aria-busy", "true");
    if (log) log.innerHTML = `<div class="cash-empty" role="status">${translate("Carregando movimentações")}</div>`;
  }
  loadRetry.hidden = true;
  loadRetry.disabled = true;
  try {
    currentRegister = await fetchCurrentCashRegister(businessId);
    renderRegister();
    const data = await loadCashierData();
    orders = data.orders;
    movements = data.movements;
    stats = data.stats;
    hasLoadedCash = true;
    cashSummary?.setAttribute("aria-busy", "false");
    renderRegister();
    render();
    setMessage(loadMessage, "");
  } catch {
    setMessage(loadMessage, translate("Não foi possível atualizar os dados do caixa Verifique a conexão e tente novamente"), "error");
    if (!hasLoadedCash) {
      cashSummary?.setAttribute("aria-busy", "false");
      log.innerHTML = `<div class="cash-empty">${translate("Os dados do caixa não estão disponíveis.")}</div>`;
    }
    loadRetry.hidden = false;
  } finally {
    refreshInProgress = false;
    loadRetry.disabled = false;
    log?.setAttribute("aria-busy", "false");
  }
};

loadRetry?.addEventListener("click", () => void initializeCashier());

const initializeCashier = async () => {
  loadRetry.hidden = true;
  loadRetry.disabled = true;
  setMessage(loadMessage, "");
  try {
    if (!appShellReady) {
      await initAppShell({ activeNav: "cashier" });
      appShellReady = true;
    }
    await refresh();
  } catch {
    setMessage(loadMessage, translate("Não foi possível abrir o caixa"), "error");
    cashSummary?.setAttribute("aria-busy", "false");
    log?.setAttribute("aria-busy", "false");
    if (!hasLoadedCash && log) {
      log.innerHTML = `<div class="cash-empty" role="alert">${translate("Os dados do caixa não estão disponíveis.")}</div>`;
    }
    loadRetry.hidden = false;
  } finally {
    loadRetry.disabled = false;
  }
};

void initializeCashier();
