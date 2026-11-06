import { getLanguage, getLocale, translate } from "../../../shared/i18n/i18n.js";
import { localizeSystemMessage } from "../../../shared/i18n/system-messages.js";
import { PAYMENT_METHODS } from "../../../shared/domain/payment-methods.js";
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
const loadAlert = document.getElementById("cashLoadAlert");
const loadAlertClose = document.getElementById("cashLoadAlertClose");
const cashSummary = document.querySelector(".cash-summary");
const pageLoading = document.getElementById("cashPageLoading");
const actionMessage = document.getElementById("cashActionMessage");
const moneyInputs = document.querySelectorAll(".cash-money-input");
let registerBusy = false;
let movementBusy = false;
let hasLoadedCash = false;
let refreshInProgress = false;
let appShellReady = false;

const normalizeMoneyInput = (input) => {
  let raw = input.value.trim().replace(/R\$|\$/gi, "").replace(/\s/g, "");
  if (!raw) return null;
  const isEnglish = getLanguage() === "en";
  const valid = isEnglish
    ? /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(raw)
    : /^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(raw);
  if (!valid) return null;
  raw = isEnglish ? raw.replace(/,/g, "") : raw.replace(/\./g, "").replace(",", ".");
  const amount = Number(raw);
  return Number.isFinite(amount) ? amount : null;
};

moneyInputs.forEach((input) => {
  input.placeholder = formatPrice(0);
  input.addEventListener("input", () => {
    const isEnglish = getLanguage() === "en";
    const decimalSeparator = isEnglish ? "." : ",";
    const groupSeparator = isEnglish ? "," : ".";
    let value = input.value.replace(/\D/g, "");
    if (value.length > 2) {
      value = `${value.slice(0, -2)}${decimalSeparator}${value.slice(-2)}`;
    }
    input.value = value.replace(new RegExp(`\\${decimalSeparator}(?=.*\\${decimalSeparator})`, "g"), "").replaceAll(groupSeparator, "");
  });
  input.addEventListener("focus", () => {
    const amount = normalizeMoneyInput(input);
    if (amount !== null) input.value = formatPrice(amount, { prefix: false });
  });
  input.addEventListener("blur", () => {
    const amount = normalizeMoneyInput(input);
    if (amount !== null) input.value = formatPrice(amount);
  });
});

const setMessage = (element, message, state = "") => {
  if (!element) return;
  element.textContent = message;
  element.hidden = !message;
  if (state) element.dataset.state = state;
  else element.removeAttribute("data-state");
};

const showLoadAlert = () => {
  pageLoading.hidden = true;
  setMessage(loadMessage, translate("loadRetryError"), "error");
  loadRetry.hidden = false;
  loadRetry.disabled = false;
  loadAlert.hidden = false;
  document.body.classList.add("modal-open");
  loadAlertClose.focus();
};

const hideLoadAlert = () => {
  loadAlert.hidden = true;
  document.body.classList.remove("modal-open");
  setMessage(loadMessage, "");
  loadRetry.hidden = true;
};

loadAlert?.addEventListener("click", (event) => {
  if (event.target.closest("[data-close-cash-alert]")) hideLoadAlert();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !loadAlert.hidden) hideLoadAlert();
});

const renderRegister = () => {
  const open = Boolean(currentRegister);
  registerStatus.hidden = false;
  registerStatus.textContent = open
    ? currentRegister.opened_at ? translate("cashOpenSince").replace("$1", formatDate(currentRegister.opened_at)) : translate("cashOpened")
    : translate("cashClosed");
  registerStatus.classList.toggle("is-open", open);
  registerStatus.classList.toggle("is-closed", !open);
  registerAction.textContent = translate(open ? "cashCloseRegister" : "cashOpenRegister");
  registerAction.disabled = registerBusy || !hasLoadedCash;
  registerAmountLabel.textContent = translate(open ? "cashCountedClosingValue" : "cashOpeningAmount");
  registerAmountLabel.hidden = !open;
  registerNotesField.hidden = !open;
  movementSubmit.disabled = !open || movementBusy || !hasLoadedCash;
  movementAvailability.hidden = open;
  const registerTitle = document.getElementById("cashRegisterTitle");
  registerTitle.hidden = false;
  registerTitle.textContent = translate(open ? "cashShiftInProgress" : "cashRegisterSituation");
  registerAmount.value = "";
  registerNotes.value = "";
};

const formatDate = (date) => {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return translate("cashTimeUnavailable");
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
  String(order.orderCode || order.order_code || order.order_number || order.id || translate("cashOrderFallback"))
    .slice(-6)
    .toUpperCase();

const getPendingCounterPayments = () =>
  orders.filter((order) => order.paymentMethod === PAYMENT_METHODS.CASH_AT_COUNTER && order.paymentStatus !== "paid");

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
          <strong>${translate("cashCodeLabel")}${escapeHtml(getOrderCode(order))}</strong><br>
          <span>${escapeHtml(order.customerName || translate("cashCustomerFallback"))} • ${escapeHtml(order.tableName || translate("cashCounterFallback"))}</span>
        </div>
        <div class="cash-row__actions">
          <strong>${escapeHtml(formatPrice(order.total || 0))}</strong>
          <button class="btn btn--secondary" type="button" data-pay-order="${escapeHtml(order.id)}">${translate("cashConfirmPayment")}</button>
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
          <strong>${escapeHtml(localizeSystemMessage(item.label))}</strong><br>
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
      ? "cashNoFilterResults"
      : "cashNoMovements";
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
  dateToggle?.setAttribute("aria-label", translate(value ? "cashChangeRemoveDateFilter" : "cashFilterByDate"));
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
    const amount = normalizeMoneyInput(registerAmount);
    if (amount === null || amount < 0) {
      registerAmount.focus();
      setMessage(registerMessage, translate("cashUpdateError"), "error");
      return;
    }
    if (currentRegister) {
      const confirmation = translate("cashConfirmClose").replace("$1", formatPrice(amount));
      if (!window.confirm(confirmation)) return;
      await closeCashRegister(businessId, currentRegister.id, amount, registerNotes.value.trim());
      currentRegister = null;
      renderRegister();
      setMessage(registerMessage, translate("cashRegisterClosed"), "success");
    } else {
      currentRegister = await openCashRegister(businessId, amount);
      renderRegister();
      setMessage(registerMessage, translate("cashRegisterOpened"), "success");
    }
    await refresh();
  } catch {
    setMessage(registerMessage, translate("cashUpdateError"), "error");
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
    const movementAmount = normalizeMoneyInput(document.getElementById("movementAmount"));
    if (movementAmount === null || movementAmount <= 0) {
      document.getElementById("movementAmount").focus();
      setMessage(movementMessage, translate("cashMovementError"), "error");
      return;
    }
    await createCashMovement(businessId, {
      type: document.getElementById("movementType").value,
      amount: movementAmount,
      description: document.getElementById("movementDescription").value.trim(),
    });
    event.target.reset();
    await refresh();
    setMessage(movementMessage, translate("cashMovementRecorded"), "success");
  } catch {
    setMessage(movementMessage, translate("cashMovementError"), "error");
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
  const confirmation = translate("cashConfirmOrderPayment").replace("$1", getOrderCode(order));
  if (!window.confirm(confirmation)) return;

  button.disabled = true;
  setMessage(actionMessage, "");
  try {
    await updateOrderStatusRemote(order.id, "completed");
    await refresh();
    setMessage(actionMessage, translate("cashPaymentCompleted"), "success");
  } catch {
    setMessage(actionMessage, translate("cashPaymentError"), "error");
    button.disabled = false;
  }
});

const refresh = async () => {
  if (refreshInProgress) return;
  refreshInProgress = true;
  pageLoading.hidden = false;
  if (!hasLoadedCash) {
    cashSummary?.setAttribute("aria-busy", "true");
    log?.setAttribute("aria-busy", "true");
    if (log) log.innerHTML = `<div class="cash-empty" role="status">${translate("cashLoadingMovements")}</div>`;
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
    pageLoading.hidden = true;
    cashSummary?.setAttribute("aria-busy", "false");
    renderRegister();
    render();
    hideLoadAlert();
  } catch {
    pageLoading.hidden = true;
    showLoadAlert();
    if (!hasLoadedCash) {
      cashSummary?.setAttribute("aria-busy", "false");
      log.innerHTML = `<div class="cash-empty">${translate("cashDataUnavailable")}</div>`;
    }
  } finally {
    refreshInProgress = false;
    loadRetry.disabled = false;
    log?.setAttribute("aria-busy", "false");
  }
};

loadRetry?.addEventListener("click", () => void initializeCashier());

const initializeCashier = async () => {
  hideLoadAlert();
  pageLoading.hidden = false;
  loadRetry.disabled = true;
  try {
    if (!appShellReady) {
      await initAppShell({ activeNav: "cashier" });
      appShellReady = true;
    }
    await refresh();
  } catch {
    showLoadAlert();
    cashSummary?.setAttribute("aria-busy", "false");
    log?.setAttribute("aria-busy", "false");
    if (!hasLoadedCash && log) {
      log.innerHTML = `<div class="cash-empty" role="alert">${translate("cashDataUnavailable")}</div>`;
    }
  } finally {
    loadRetry.disabled = false;
  }
};

void initializeCashier();
