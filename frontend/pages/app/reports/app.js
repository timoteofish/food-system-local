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
const money = new Intl.NumberFormat(getLocale(), { style: "currency", currency: "BRL" });
const percent = new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 1 });
const quantity = new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 3 });
const count = new Intl.NumberFormat(getLocale());
let reportLoading = false;

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
  productRows.innerHTML = `<tr><td class="report-empty" colspan="3">${translate("Dados indisponíveis")}</td></tr>`;
};

const setUnavailableProfitability = () => {
  ["cogsTotal", "grossProfit"].forEach((id) => {
    document.getElementById(id).textContent = "—";
  });
  document.getElementById("grossMargin").textContent = "—";
};

const setUnavailableStock = () => {
  criticalStock.innerHTML = `<p class="operation-empty">${translate("Dados indisponíveis")}</p>`;
};

const setUnavailableReport = () => {
  setUnavailableSales();
  setUnavailableProfitability();
  setUnavailableStock();
};

const renderProducts = (products) => {
  const body = productRows;
  if (!products.length) {
    body.innerHTML = `<tr><td colspan="3">${translate("Sem vendas neste período")}</td></tr>`;
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
    list.innerHTML = `<p class="operation-empty">${translate("Nenhum insumo em nível crítico")}</p>`;
    return;
  }

  list.innerHTML = items.map((item) => {
    const minimumLabel = translate("Mínimo").toLocaleLowerCase(getLocale());
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
    setFeedback("Selecione as duas datas para gerar o relatório");
    return;
  }
  if (start > end) {
    setFeedback("A data inicial deve ser anterior ou igual à data final");
    return;
  }

  reportLoading = true;
  loadButton.disabled = true;
  loadButton.textContent = translate("Atualizando relatório");
  reportMetrics.setAttribute("aria-busy", "true");
  productRows.setAttribute("aria-busy", "true");
  criticalStock.setAttribute("aria-busy", "true");
  setFeedback("Atualizando relatório", "loading");

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

    if (hasUnavailableData) setFeedback("Alguns dados do relatório não puderam ser carregados", "error");
    else setFeedback();
  } catch (error) {
    setUnavailableReport();
    setFeedback("Não foi possível carregar o relatório", "error");
  } finally {
    reportLoading = false;
    reportMetrics.setAttribute("aria-busy", "false");
    productRows.setAttribute("aria-busy", "false");
    criticalStock.setAttribute("aria-busy", "false");
    loadButton.disabled = false;
    loadButton.textContent = translate("Atualizar relatório");
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
  try {
    await initAppShell({ activeNav: "reports" });
    await loadReport();
  } catch (error) {
    setUnavailableReport();
    reportMetrics.setAttribute("aria-busy", "false");
    productRows.setAttribute("aria-busy", "false");
    criticalStock.setAttribute("aria-busy", "false");
    setFeedback("Não foi possível abrir os relatórios", "error");
  }
};

void start();
