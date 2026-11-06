import { getSession } from "../../../shared/data/storage.js";
import { formatPrice, formatTime } from "../../../shared/utils/utils.js";
import { getLocale, translate } from "../../../shared/i18n/i18n.js";
import { initAppShell } from "../../../shared/ui/ui.js";
import { loadDashboardData } from "../../../shared/features/dashboard/index.js";

const session = getSession();
const numberFormat = new Intl.NumberFormat(getLocale());
const dashboardStats = document.querySelector(".dashboard-stats");
const recentOrders = document.getElementById("recentOrders");
const feedback = document.getElementById("dashboardFeedback");
const retryButton = document.getElementById("dashboardRetry");
const loadingIndicator = document.getElementById("dashboardLoading");
const errorModal = document.getElementById("dashboardErrorModal");
const errorClose = document.getElementById("dashboardErrorClose");
let loading = false;
let hasLoadedDashboard = false;
let appShellReady = false;

const hideDashboardError = () => {
  errorModal.hidden = true;
  document.body.classList.remove("modal-open");
};

const showDashboardError = () => {
  loadingIndicator.hidden = true;
  dashboardStats.setAttribute("aria-busy", "false");
  recentOrders.setAttribute("aria-busy", "false");
  recentOrders.replaceChildren();
  feedback.textContent = translate("loadRetryError");
  errorModal.hidden = false;
  document.body.classList.add("modal-open");
  errorClose.focus();
};

errorModal.addEventListener("click", (event) => {
  if (event.target.closest("[data-close-dashboard-error]")) hideDashboardError();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !errorModal.hidden) hideDashboardError();
});

const renderRecentOrders = (orders) => {
  recentOrders.replaceChildren();
  if (!orders.length) {
    const empty = document.createElement("p");
    empty.className = "dashboard-empty";
    empty.setAttribute("role", "status");
    empty.textContent = translate("No orders to show");
    recentOrders.append(empty);
    return;
  }

  orders.forEach((order) => {
    const row = document.createElement("article");
    row.className = "recent-order";
    const identity = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = `${translate("Order")} #${order.orderCode || String(order.id).slice(-6)}`;
    const detail = document.createElement("span");
    const itemCount = Array.isArray(order.items) ? order.items.length : 0;
    const itemWord = translate(itemCount === 1 ? "item" : "items");
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
  hideDashboardError();
  loadingIndicator.hidden = false;
  retryButton.disabled = true;
  dashboardStats.setAttribute("aria-busy", "true");
  recentOrders.setAttribute("aria-busy", "true");
  if (!hasLoadedDashboard) recentOrders.replaceChildren();

  try {
    const { stats, orders } = await loadDashboardData();
    document.getElementById("activeProducts").textContent = numberFormat.format(stats.activeProducts);
    document.getElementById("ordersValueToday").textContent = formatPrice(stats.ordersValueToday);
    document.getElementById("ordersToday").textContent = numberFormat.format(stats.ordersToday || 0);
    document.getElementById("activeLocations").textContent = numberFormat.format(stats.activeLocations || 0);
    renderRecentOrders(orders);
    hasLoadedDashboard = true;
    loadingIndicator.hidden = true;
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

retryButton.addEventListener("click", () => void initializeDashboard());

const initializeDashboard = async () => {
  hideDashboardError();
  loadingIndicator.hidden = false;
  loadingIndicator.querySelector("[data-dashboard-loading-label]").textContent = translate("Loading");
  try {
    if (!appShellReady) {
      await initAppShell({ activeNav: "dashboard" });
      appShellReady = true;
    }
    await loadDashboard();
  } catch {
    showDashboardError();
    retryButton.disabled = false;
  }
};

void initializeDashboard();
