import "../../../shared/i18n/legacy-control.js";
import {
  closeDiningTab,
  createRestaurantTable,
  fetchDiningTabs,
  fetchRestaurantTables,
  openDiningTab,
  transferDiningTab,
} from "../../../shared/api/client.js";
import { getSession } from "../../../shared/data/storage.js";
import { escapeHtml, formatPrice } from "../../../shared/utils/utils.js";
import { getLocale, translate } from "../../../shared/i18n/i18n.js";
import { initAppShell, showToast } from "../../../shared/ui/ui.js";

const businessId = getSession()?.businessId;
const grid = document.getElementById("tableGrid");
const tableForm = document.getElementById("tableForm");
const status = document.getElementById("status");
const countFormat = new Intl.NumberFormat(getLocale());
let tables = [];
let tabs = [];
let actionInProgress = false;
let appShellReady = false;

const getOpenTab = (tableId) => tabs.find((tab) => tab.table_id === tableId && tab.status === "open");

const renderEmptyState = () => {
  grid.innerHTML = `<p class="operation-empty">${translate("No tables registered")}</p>`;
};

const render = () => {
  if (!tables.length) {
    renderEmptyState();
    return;
  }

  grid.innerHTML = tables.map((table) => {
    const tab = getOpenTab(table.id);
    const statusClass = tab ? "is-open" : "is-available";
    const statusLabel = translate(tab ? "In service" : "Available");
    const orderCount = Number(tab?.order_count || 0);
    const orderLabel = `${countFormat.format(orderCount)} ${translate(orderCount === 1 ? "order" : "orders")}`;
    const destinationOptions = tables
      .filter((item) => item.id !== table.id)
      .map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`)
      .join("");

    return `
      <article class="table-card ${statusClass}">
        <div class="table-card__head">
          <strong>${escapeHtml(table.name)}</strong>
          <span class="table-card__status">${statusLabel}</span>
        </div>
        ${tab ? `
          <div class="table-card__total">
            ${formatPrice(tab.total)}
            <small>${orderLabel}</small>
          </div>
          <div class="table-actions">
            <button class="btn btn--secondary" data-close="${escapeHtml(tab.id)}" type="button">${translate("Close tab")}</button>
            <select data-transfer="${escapeHtml(tab.id)}" aria-label="${escapeHtml(translate("tableTransferLabel").replace("$1", table.name))}">
              <option value="">${translate("Select a destination table")}</option>
              ${destinationOptions}
            </select>
          </div>
        ` : `
          <button class="btn btn--primary" data-open="${escapeHtml(table.id)}" type="button">${translate("Open tab")}</button>
        `}
      </article>
    `;
  }).join("");
};

const load = async () => {
  grid.setAttribute("aria-busy", "true");
  grid.innerHTML = `<p class="operation-empty" role="status">${translate("Loading tables")}</p>`;
  try {
    [tables, tabs] = await Promise.all([
      fetchRestaurantTables(businessId),
      fetchDiningTabs(businessId),
    ]);
    render();
    grid.setAttribute("aria-busy", "false");
    return true;
  } catch (error) {
    const message = translate("Could not load tables");
    grid.innerHTML = `<div class="operation-empty" role="alert"><p>${escapeHtml(message)}</p><button class="btn btn--secondary" type="button" data-table-retry>${translate("Try again")}</button></div>`;
    grid.setAttribute("aria-busy", "false");
    showToast(message, { type: "error" });
    return false;
  }
};

tableForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type='submit']");
  const name = new FormData(form).get("name")?.trim();
  if (!name) return;

  button.disabled = true;
  status.textContent = "";

  try {
    await createRestaurantTable(businessId, name);
    form.reset();
    showToast(translate("Table added"));
    await load();
  } catch (error) {
    status.textContent = translate("Could not add the table");
  } finally {
    button.disabled = false;
  }
});

const runTableAction = async (button, action, successMessage) => {
  if (actionInProgress) {
    if (button?.tagName === "SELECT") button.value = "";
    return;
  }
  actionInProgress = true;
  if (button) button.disabled = true;

  try {
    await action();
    showToast(translate(successMessage));
    await load();
  } catch (error) {
    if (button?.tagName === "SELECT") button.value = "";
    showToast(translate("Could not update the tab"), { type: "error" });
  } finally {
    if (button?.isConnected) button.disabled = false;
    actionInProgress = false;
  }
};

grid.addEventListener("click", (event) => {
  if (event.target.closest("[data-table-retry]")) {
    void start();
    return;
  }
  const openButton = event.target.closest("[data-open]");
  const closeButton = event.target.closest("[data-close]");

  if (openButton) {
    void runTableAction(
      openButton,
      () => openDiningTab(businessId, openButton.dataset.open),
      "Tab opened"
    );
  }

  if (closeButton) {
    void runTableAction(
      closeButton,
      () => closeDiningTab(businessId, closeButton.dataset.close),
      "Tab closed"
    );
  }
});

grid.addEventListener("change", (event) => {
  const select = event.target.closest("[data-transfer]");
  if (!select?.value) return;

  void runTableAction(
    select,
    () => transferDiningTab(businessId, select.dataset.transfer, select.value),
    "Tab transferred"
  );
});

const start = async () => {
  try {
    if (!appShellReady) {
      await initAppShell({ activeNav: "tables" });
      appShellReady = true;
    }
    await load();
  } catch (error) {
    const message = translate("Could not open tables and tabs");
    grid.innerHTML = `<div class="operation-empty" role="alert"><p>${escapeHtml(message)}</p><button class="btn btn--secondary" type="button" data-table-retry>${translate("Try again")}</button></div>`;
    grid.setAttribute("aria-busy", "false");
    showToast(message, { type: "error" });
  }
};

void start();
