import "../../../shared/i18n/legacy-control.js";
import { getLocale, translate } from "../../../shared/i18n/i18n.js";
import { getSession } from "../../../shared/data/storage.js";
import { apiRequest } from "../../../shared/api/client.js";
import { initAppShell } from "../../../shared/ui/ui.js";
import { formatInventoryUnit } from "../../../shared/utils/utils.js";

const businessId = getSession()?.businessId;
const fromDate = document.getElementById("fromDate");
const toDate = document.getElementById("toDate");
const reportForm = document.getElementById("reportForm");
const loadButton = document.getElementById("loadReport");
const feedback = document.getElementById("reportFeedback");
const reportMetrics = document.getElementById("reportMetrics");
const productRows = document.getElementById("productRows");
const criticalStock = document.getElementById("criticalStock");
const reportPageLoading = document.getElementById("reportPageLoading");
const reportErrorModal = document.getElementById("reportErrorModal");
const reportLoadError = document.getElementById("reportLoadError");
const reportRetry = document.getElementById("reportRetry");
const reportErrorClose = document.getElementById("reportErrorClose");
const money = new Intl.NumberFormat(getLocale(), { style: "currency", currency: "BRL" });
const percent = new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 1 });
const quantity = new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 3 });
const count = new Intl.NumberFormat(getLocale());
let reportLoading = false;
let appShellReady = false;

const setReportLoading = (isLoading) => {
  reportPageLoading.hidden = !isLoading;
  if (isLoading) {
    reportPageLoading.querySelector("[data-report-loading-label]").textContent = translate("Loading");
  }
};

const hideReportError = () => {
  reportErrorModal.hidden = true;
  document.body.classList.remove("modal-open");
};

const showReportError = (message) => {
  setReportLoading(false);
  reportLoadError.textContent = message;
  reportErrorModal.hidden = false;
  document.body.classList.add("modal-open");
  reportErrorClose.focus();
};

reportErrorModal.addEventListener("click", (event) => {
  if (event.target.closest("[data-close-report-error]")) hideReportError();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !reportErrorModal.hidden) hideReportError();
});

const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "'": "&#39;",
  '"': "&quot;",
}[character]));

const formatMoney = (value) => money.format(Number(value) || 0);
const formatPercent = (value) => `${percent.format(Number(value) || 0)}%`;
const formatQuantity = (value) => quantity.format(Number(value) || 0);
const setFeedback = (message = "", state = "") => {
  feedback.textContent = message ? translate(message) : "";
  feedback.hidden = !message;
  if (state) feedback.dataset.state = state;
  else feedback.removeAttribute("data-state");
};
const localDate = (date = new Date()) => {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
};

const setUnavailableSales = () => {
  document.getElementById("orderTotal").textContent = "—";
  ["revenueTotal", "averageTicket"].forEach((id) => {
    document.getElementById(id).textContent = "—";
  });
  productRows.innerHTML = `<tr><td class="report-empty" colspan="3">${translate("reportUnavailable")}</td></tr>`;
};

const setUnavailableProfitability = () => {
  ["cogsTotal", "grossProfit"].forEach((id) => {
    document.getElementById(id).textContent = "—";
  });
  document.getElementById("grossMargin").textContent = "—";
};

const setUnavailableStock = () => {
  criticalStock.innerHTML = `<p class="operation-empty">${translate("reportUnavailable")}</p>`;
};

const setUnavailableReport = () => {
  setUnavailableSales();
  setUnavailableProfitability();
  setUnavailableStock();
};

const renderProducts = (products) => {
  const body = productRows;
  if (!products.length) {
    body.innerHTML = `<tr><td colspan="3">${translate("reportNoSales")}</td></tr>`;
    return;
  }

  body.innerHTML = products.map((product) => `
    <tr>
      <td>${escapeHtml(product.name)}</td>
      <td>${formatQuantity(product.quantity)}</td>
      <td>${formatMoney(product.revenue)}</td>
    </tr>
  `).join("");
};

const renderCriticalStock = (items) => {
  const list = criticalStock;
  if (!items.length) {
    list.innerHTML = `<p class="operation-empty">${translate("reportNoCriticalStock")}</p>`;
    return;
  }

  list.innerHTML = items.map((item) => {
    const minimumLabel = translate("reportMinimum").toLocaleLowerCase(getLocale());
    return `
      <p>
        <strong>${escapeHtml(item.name)}</strong>
        <span>${formatQuantity(item.current_quantity)} ${escapeHtml(formatInventoryUnit(item.unit))} · ${minimumLabel} ${formatQuantity(item.minimum_quantity)}</span>
      </p>
    `;
  }).join("");
};

const loadReport = async () => {
  if (reportLoading) return;
  const start = fromDate.value;
  const end = toDate.value;
  if (!start || !end) {
    setFeedback("reportSelectBothDates");
    return;
  }
  if (start > end) {
    setFeedback("reportStartDateOrder");
    return;
  }

  reportLoading = true;
  hideReportError();
  setReportLoading(true);
  loadButton.disabled = true;
  reportMetrics.setAttribute("aria-busy", "true");
  productRows.setAttribute("aria-busy", "true");
  criticalStock.setAttribute("aria-busy", "true");
  setFeedback();

  try {
    const query = new URLSearchParams({ from: start, to: end });
    const results = await Promise.allSettled([
      apiRequest(`/businesses/${businessId}/reports/sales?${query}`),
      apiRequest(`/businesses/${businessId}/reports/critical-stock`),
      apiRequest(`/businesses/${businessId}/reports/profitability?${query}`),
    ]);
    const [salesResult, stockResult, profitabilityResult] = results;
    let hasUnavailableData = false;

    if (salesResult.status === "fulfilled") {
      const sales = salesResult.value;
      document.getElementById("orderTotal").textContent = count.format(Number(sales.summary?.orders) || 0);
      document.getElementById("revenueTotal").textContent = formatMoney(sales.summary?.revenue);
      document.getElementById("averageTicket").textContent = formatMoney(sales.summary?.average_ticket);
      renderProducts(Array.isArray(sales.products) ? sales.products : []);
    } else {
      setUnavailableSales();
      hasUnavailableData = true;
    }

    if (profitabilityResult.status === "fulfilled") {
      const profitability = profitabilityResult.value;
      document.getElementById("cogsTotal").textContent = formatMoney(profitability.cogs);
      document.getElementById("grossProfit").textContent = formatMoney(profitability.gross_profit);
      document.getElementById("grossMargin").textContent = formatPercent(profitability.gross_margin);
    } else {
      setUnavailableProfitability();
      hasUnavailableData = true;
    }

    if (stockResult.status === "fulfilled") {
      renderCriticalStock(Array.isArray(stockResult.value.items) ? stockResult.value.items : []);
    } else {
      setUnavailableStock();
      hasUnavailableData = true;
    }

    if (hasUnavailableData) showReportError(translate("reportPartialError"));
    else setFeedback();
  } catch (error) {
    setUnavailableReport();
    showReportError(translate("reportPageLoadError"));
  } finally {
    reportLoading = false;
    setReportLoading(false);
    reportMetrics.setAttribute("aria-busy", "false");
    productRows.setAttribute("aria-busy", "false");
    criticalStock.setAttribute("aria-busy", "false");
    loadButton.disabled = false;
  }
};

const today = localDate();
fromDate.value = today;
toDate.value = today;
reportForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void loadReport();
});

const start = async () => {
  hideReportError();
  setReportLoading(true);
  reportRetry.disabled = true;
  try {
    if (!appShellReady) {
      await initAppShell({ activeNav: "reports" });
      appShellReady = true;
    }
    await loadReport();
  } catch (error) {
    setUnavailableReport();
    reportMetrics.setAttribute("aria-busy", "false");
    productRows.setAttribute("aria-busy", "false");
    criticalStock.setAttribute("aria-busy", "false");
    showReportError(translate("reportOpenError"));
  } finally {
    setReportLoading(false);
    reportRetry.disabled = false;
  }
};

reportRetry.addEventListener("click", () => void start());
void start();
