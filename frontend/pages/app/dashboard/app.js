import { getSession } from "../../../shared/data/storage.js";
import { formatPrice } from "../../../shared/utils/utils.js";
import { initAppShell } from "../../../shared/ui/ui.js";
import { loadDashboardData } from "../../../shared/features/dashboard/index.js";

(async () => {
  await initAppShell({ activeNav: "dashboard" });

  const session = getSession();
  const { stats, orders } = await loadDashboardData();
  document.getElementById("activeProducts").textContent = String(stats.activeProducts);
  document.getElementById("salesToday").textContent = formatPrice(stats.salesToday);
  document.getElementById("ordersToday").textContent = String(stats.ordersToday || 0);
  document.getElementById("activeTables").textContent = String(stats.activeTables || 0);

  const welcome = document.getElementById("welcomeName");
  if (welcome && session?.name) {
    welcome.textContent = session.name.split(" ")[0];
  }

})();
