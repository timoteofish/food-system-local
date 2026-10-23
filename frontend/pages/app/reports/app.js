import "../../../shared/i18n/legacy-control.js";
import { getSession } from "../../../shared/data/storage.js";
import { apiRequest } from "../../../shared/api/client.js";
import { initAppShell } from "../../../shared/ui/ui.js";

const businessId = getSession()?.businessId;
const money = (value) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
const today = new Date().toISOString().slice(0, 10);
const reportPanel = document.querySelector(".report-grid");
if (reportPanel && !document.getElementById("cogsTotal")) {
  reportPanel.insertAdjacentHTML("beforeend", '<article class="panel"><span>CMV</span><div class="report-value" id="cogsTotal">R$ 0,00</div></article><article class="panel"><span>Lucro bruto</span><div class="report-value" id="grossProfit">R$ 0,00</div></article><article class="panel"><span>Margem bruta</span><div class="report-value" id="grossMargin">0%</div></article>');
}
document.getElementById("fromDate").value = today;
document.getElementById("toDate").value = today;
const load = async () => {
  const query = new URLSearchParams({ from: document.getElementById("fromDate").value, to: document.getElementById("toDate").value });
  const [sales, stock, profitability] = await Promise.all([apiRequest(`/businesses/${businessId}/reports/sales?${query}`), apiRequest(`/businesses/${businessId}/reports/critical-stock`), apiRequest(`/businesses/${businessId}/reports/profitability?${query}`)]);
  document.getElementById("orderTotal").textContent = sales.summary.orders;
  document.getElementById("revenueTotal").textContent = money(sales.summary.revenue);
  document.getElementById("averageTicket").textContent = money(sales.summary.average_ticket);
  document.getElementById("cogsTotal").textContent = money(profitability.cogs);
  document.getElementById("grossProfit").textContent = money(profitability.gross_profit);
  document.getElementById("grossMargin").textContent = `${profitability.gross_margin}%`;
  document.getElementById("productRows").innerHTML = sales.products.length ? sales.products.map((row) => `<tr><td>${escapeHtml(row.name)}</td><td>${row.quantity}</td><td>${money(row.revenue)}</td></tr>`).join("") : '<tr><td colspan="3">No sales.</td></tr>';
  document.getElementById("criticalStock").innerHTML = stock.items.length ? stock.items.map((item) => `<p>${escapeHtml(item.name)}: ${item.current_quantity} ${escapeHtml(item.unit)} (minimum ${item.minimum_quantity})</p>`).join("") : "No critical stock.";
};
document.getElementById("loadReport").addEventListener("click", load);
(async () => { await initAppShell({ activeNav: "reports" }); await load(); })();
