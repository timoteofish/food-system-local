import { getSession } from "../../../shared/data/storage.js";
import { formatPrice, formatTime } from "../../../shared/utils/utils.js";
import { getLanguage, getLocale, translate } from "../../../shared/i18n/i18n.js";
import { initAppShell } from "../../../shared/ui/ui.js";
import { loadDashboardData } from "../../../shared/features/dashboard/index.js";

const session = getSession();
const numberFormat = new Intl.NumberFormat(getLocale());
const dashboardStats = document.querySelector(".dashboard-stats");
const recentOrders = document.getElementById("recentOrders");
const feedback = document.getElementById("dashboardFeedback");
const retryButton = document.getElementById("dashboardRetry");
let loading = false;
let hasLoadedDashboard = false;

const showDashboardError = () => {
  dashboardStats.setAttribute("aria-busy", "false");
  recentOrders.setAttribute("aria-busy", "false");
  recentOrders.innerHTML = `<p class="dashboard-empty" role="status">${translate("Pedidos recentes indisponíveis")}</p>`;
  feedback.textContent = translate("Não foi possível carregar o painel Verifique a conexão e tente novamente");
  feedback.hidden = false;
  retryButton.hidden = false;
};

const renderRecentOrders = (orders) => {
  recentOrders.replaceChildren();
  if (!orders.length) {
    const empty = document.createElement("p");
    empty.className = "dashboard-empty";
    empty.setAttribute("role", "status");
    empty.textContent = translate("Nenhum pedido para mostrar");
    recentOrders.append(empty);
    return;
  }

  orders.forEach((order) => {
    const row = document.createElement("article");
    row.className = "recent-order";
    const identity = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = `${translate("Pedido")} #${order.orderCode || String(order.id).slice(-6)}`;
    const detail = document.createElement("span");
    const itemCount = Array.isArray(order.items) ? order.items.length : 0;
    const itemWord = itemCount === 1
      ? translate("item")
      : translate(getLanguage() === "en" ? "items" : "itens");
    const createdAt = order.createdAt ? new Date(order.createdAt) : null;
    const time = createdAt && Number.isFinite(createdAt.getTime()) ? formatTime(createdAt) : "";
    detail.textContent = `${numberFormat.format(itemCount)} ${itemWord}${time ? ` · ${time}` : ""}`;
    identity.append(title, detail);
    const total = document.createElement("strong");
    total.textContent = formatPrice(order.total);
    row.append(identity, total);
    recentOrders.append(row);
  });
};

const loadDashboard = async () => {
  if (loading) return;
  loading = true;
  retryButton.hidden = true;
  retryButton.disabled = true;
  feedback.hidden = true;
  dashboardStats.setAttribute("aria-busy", "true");
  recentOrders.setAttribute("aria-busy", "true");
  if (!hasLoadedDashboard) {
    recentOrders.innerHTML = `<p class="dashboard-empty" role="status">${translate("Carregando pedidos")}</p>`;
  }

  try {
    const { stats, orders } = await loadDashboardData();
    document.getElementById("activeProducts").textContent = numberFormat.format(stats.activeProducts);
    document.getElementById("ordersValueToday").textContent = formatPrice(stats.ordersValueToday);
    document.getElementById("ordersToday").textContent = numberFormat.format(stats.ordersToday || 0);
    document.getElementById("activeLocations").textContent = numberFormat.format(stats.activeLocations || 0);
    renderRecentOrders(orders);
    hasLoadedDashboard = true;
    dashboardStats.setAttribute("aria-busy", "false");
    recentOrders.setAttribute("aria-busy", "false");
  } catch {
    showDashboardError();
  } finally {
    loading = false;
    retryButton.disabled = false;
  }
};

if (session?.name) {
  const welcome = document.getElementById("welcomeName");
  if (welcome) welcome.textContent = session.name.split(" ")[0];
}

retryButton.addEventListener("click", () => void loadDashboard());

(async () => {
  try {
    await initAppShell({ activeNav: "dashboard" });
    await loadDashboard();
  } catch {
    showDashboardError();
    retryButton.disabled = false;
  }
})();
