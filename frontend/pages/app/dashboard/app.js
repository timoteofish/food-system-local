import { getSession } from "../../../shared/data/storage.js";
import { formatPrice } from "../../../shared/utils/utils.js";
import { getLocale, translate } from "../../../shared/i18n/i18n.js";
import { initAppShell } from "../../../shared/ui/ui.js";
import { loadDashboardData } from "../../../shared/features/dashboard/index.js";

const session = getSession();
const numberFormat = new Intl.NumberFormat(getLocale());
const dashboardStats = document.querySelector(".dashboard-stats");
const feedback = document.getElementById("dashboardFeedback");
const retryButton = document.getElementById("dashboardRetry");
const loadingIndicator = document.getElementById("dashboardLoading");
const errorModal = document.getElementById("dashboardErrorModal");
const errorClose = document.getElementById("dashboardErrorClose");
let loading = false;
let appShellReady = false;

const hideDashboardError = () => {
  errorModal.hidden = true;
  document.body.classList.remove("modal-open");
};

const showDashboardError = () => {
  loadingIndicator.hidden = true;
  dashboardStats.setAttribute("aria-busy", "false");
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

const loadDashboard = async () => {
  if (loading) return;
  loading = true;
  hideDashboardError();
  loadingIndicator.hidden = false;
  retryButton.disabled = true;
  dashboardStats.setAttribute("aria-busy", "true");

  try {
    const { stats } = await loadDashboardData();
    document.getElementById("activeProducts").textContent = numberFormat.format(stats.activeProducts);
    document.getElementById("ordersValueToday").textContent = formatPrice(stats.ordersValueToday);
    document.getElementById("ordersToday").textContent = numberFormat.format(stats.ordersToday || 0);
    document.getElementById("activeLocations").textContent = numberFormat.format(stats.activeLocations || 0);
    loadingIndicator.hidden = true;
    dashboardStats.setAttribute("aria-busy", "false");
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
