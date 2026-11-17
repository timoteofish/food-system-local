import { getSession } from "../../../../shared/data/storage.js";
import { apiRequest } from "../../../../shared/api/client.js";
import { initAppShell } from "../../../../shared/ui/ui.js";
import { getLocale, translate } from "../../../../shared/i18n/i18n.js";
import { formatInventoryUnit, parseApiTimestamp, parseInventoryQuantity } from "../../../../shared/utils/utils.js";

const session = getSession();
const businessId = session?.businessId;
const rows = document.getElementById("inventoryRows");
const count = document.getElementById("inventoryCount");
const movementRows = document.getElementById("inventoryMovementRows");
const movementCount = document.getElementById("inventoryMovementCount");
const purchaseLineList = document.getElementById("purchaseLines");
const purchaseRows = document.getElementById("inventoryPurchaseRows");
const purchaseCount = document.getElementById("inventoryPurchaseCount");
const inventorySearch = document.getElementById("inventorySearch");
const inventoryLocationFilter = document.getElementById("inventoryLocationFilter");
const locationList = document.getElementById("inventoryLocations");
const loadingIndicator = document.getElementById("inventoryLoading");
const errorModal = document.getElementById("inventoryErrorModal");
const loadErrorMessage = document.getElementById("inventoryLoadError");
const retryButton = document.getElementById("inventoryRetry");
const errorClose = document.getElementById("inventoryErrorClose");
const successModal = document.getElementById("inventorySuccessModal");
const successMessage = document.getElementById("inventorySuccessMessage");
const successClose = document.getElementById("inventorySuccessClose");
const resultPanel = document.getElementById("inventoryResultPanel");
const resultMark = document.getElementById("inventoryResultMark");
const movementType = document.getElementById("movementType");
const movementDirectionField = document.getElementById("movementDirectionField");
const recipeIngredientsList = document.getElementById("recipeIngredients");
let items = [];
let displayItems = [];
let locations = [];
let movements = [];
let transfers = [];
let reorderAlerts = [];
let inventoryLots = [];
let stockCounts = [];
let productionOrders = [];
let activeStockCountId = null;
let totalMovements = 0;
let purchases = [];
let totalPurchases = 0;
let purchaseOrders = [];
const receiptIdempotencyKeys = new Map();
let products = [];
let suppliers = [];
let recipeIngredients = [];
let recipeRevision = null;
let loadedRecipeProductId = "";
let recipeLoaded = false;
let recipeDirty = false;
let recipeLoadSequence = 0;
let productionRecipeStatus = "unselected";
let productionRecipeProductId = "";
let productionRecipeLoadSequence = 0;
let hasLoadedInventory = false;
let hasLoadedProducts = false;
let hasLoadedSuppliers = false;
let hasLoadedLocations = false;
let loading = false;
let appShellReady = false;
let inventorySearchQuery = "";
let successReturnFocus = null;
let loadedInventoryLocationFilter = "";
let locationFilterRequestSequence = 0;

const setLoading = (isLoading) => {
  loadingIndicator.hidden = !isLoading;
  if (isLoading) {
    loadingIndicator.querySelector("[data-inventory-loading-label]").textContent = translate("Loading");
  }
};

const hideLoadError = () => {
  errorModal.hidden = true;
  document.body.classList.remove("modal-open");
};

const showLoadError = () => {
  setLoading(false);
  loadErrorMessage.textContent = translate("loadRetryError");
  retryButton.disabled = false;
  errorModal.hidden = false;
  document.body.classList.add("modal-open");
  errorClose.focus();
};

const hideSuccess = () => {
  successModal.hidden = true;
  document.body.classList.remove("modal-open");
  const target = successReturnFocus instanceof HTMLElement && !successReturnFocus.disabled
    ? successReturnFocus
    : document.getElementById("itemName");
  target.focus();
  successReturnFocus = null;
};

const showResult = (message, state = "success") => {
  successReturnFocus = document.activeElement;
  successMessage.textContent = message;
  resultPanel.dataset.state = state;
  successMessage.setAttribute("role", state === "error" ? "alert" : "status");
  resultMark.innerHTML = state === "error"
    ? '<svg viewBox="0 0 48 48" focusable="false"><path d="m15 15 18 18M33 15 15 33" /></svg>'
    : '<svg viewBox="0 0 48 48" focusable="false"><path d="m13 25 7 7 15-16" /></svg>';
  successModal.hidden = false;
  document.body.classList.add("modal-open");
  successClose.focus();
};

const showSuccess = (message) => showResult(message, "success");
const showFailure = (message) => showResult(message, "error");

errorModal.addEventListener("click", (event) => {
  if (event.target.closest("[data-close-inventory-error]")) hideLoadError();
});
successModal.addEventListener("click", (event) => {
  if (event.target.closest("[data-close-inventory-success]")) hideSuccess();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !errorModal.hidden) hideLoadError();
  else if (event.key === "Escape" && !successModal.hidden) hideSuccess();
});

const setInventoryPanelCollapsed = (panel, collapsed) => {
  panel.classList.toggle("is-collapsed", collapsed);
  const toggle = panel.querySelector("[data-inventory-panel-toggle]");
  if (toggle) toggle.setAttribute("aria-expanded", String(!collapsed));
};

document.addEventListener("click", (event) => {
  const toggle = event.target.closest("[data-inventory-panel-toggle]");
  if (!toggle) return;
  const panel = toggle.closest("[data-inventory-panel]");
  if (!panel) return;
  setInventoryPanelCollapsed(panel, !panel.classList.contains("is-collapsed"));
});

const escapeHtml = (value) => String(value ?? "").replace(/[&<>\'"]/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "'": "&#39;",
  '"': "&quot;",
}[char]));

const formatNumber = (value) => Number(value || 0).toLocaleString(
  getLocale(),
  { maximumFractionDigits: 3 },
);
const setMessage = (element, text, state = "error") => {
  if (!element) return;
  element.textContent = text;
  element.dataset.state = state;
  element.hidden = !text;
};

const numericFields = document.querySelectorAll(".inventory-form input[type='number']");
numericFields.forEach((input) => {
  input.addEventListener("focus", () => {
    if (input.value === "0") input.value = "";
  });
  input.addEventListener("beforeinput", (event) => {
    if (!event.inputType.startsWith("insert") || event.isComposing) return;
    const inserted = event.data ?? event.dataTransfer?.getData("text/plain");
    if (inserted === null || inserted === undefined) return;
    if (!/^\d*(?:[.,]\d*)?$/.test(inserted)) {
      event.preventDefault();
      return;
    }
    if (/[.,]/.test(inserted) && /[.,]/.test(input.value)) event.preventDefault();
  });
});

const clearMessage = (element) => {
  if (!element) return;
  element.textContent = "";
  element.hidden = true;
  element.removeAttribute("data-state");
};
const getFormIdempotencyKey = (form) => {
  if (!form.dataset.idempotencyKey) form.dataset.idempotencyKey = crypto.randomUUID();
  return form.dataset.idempotencyKey;
};

const isItemActive = (item) => item.active !== false && item.active !== 0;
const activeItems = () => items.filter(isItemActive);
const optionsForItems = () => activeItems().map((item) =>
  `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)} (${escapeHtml(formatInventoryUnit(item.unit))})</option>`
).join("");

const updateRecipeSubmitState = () => {
  document.getElementById("recipeSubmit").disabled = !hasLoadedInventory || !hasLoadedProducts || activeItems().length === 0 || products.length === 0 || !loadedRecipeProductId || !recipeLoaded || recipeIngredients.length === 0;
};

const updateProductionAvailability = () => {
  const productId = document.getElementById("productionProduct").value;
  const button = document.getElementById("productionSubmit");
  const hint = document.getElementById("productionRecipeAvailability");
  const recipeChecked = productionRecipeProductId === productId;
  const recipeAvailable = recipeChecked && productionRecipeStatus === "available";
  button.disabled = !hasLoadedLocations || !hasLoadedProducts || !productId || !recipeAvailable;
  hint.hidden = !productId || recipeAvailable || !hasLoadedProducts;
  if (!productId) hint.textContent = "";
  else if (!recipeChecked || productionRecipeStatus === "checking") hint.textContent = translate("inventoryProductionCheckingRecipe");
  else if (productionRecipeStatus === "missing") hint.textContent = translate("inventoryProductionNeedsRecipe");
  else if (productionRecipeStatus === "failed") hint.textContent = translate("inventoryProductionRecipeCheckError");
};

const checkProductionRecipe = async (productId) => {
  const requestSequence = ++productionRecipeLoadSequence;
  productionRecipeProductId = productId;
  productionRecipeStatus = productId ? "checking" : "unselected";
  updateProductionAvailability();
  if (!productId) return;
  try {
    const recipe = await apiRequest(`/businesses/${businessId}/products/${encodeURIComponent(productId)}/recipe`);
    if (requestSequence !== productionRecipeLoadSequence) return;
    productionRecipeStatus = Array.isArray(recipe.ingredients) && recipe.ingredients.length > 0 ? "available" : "missing";
  } catch {
    if (requestSequence !== productionRecipeLoadSequence) return;
    productionRecipeStatus = "failed";
  }
  updateProductionAvailability();
};

const renderSelectOptions = () => {
  const itemOptions = optionsForItems();
  const itemPlaceholder = !hasLoadedInventory
    ? translate("inventoryItemsUnavailable")
    : activeItems().length ? translate("inventorySelectItem") : translate("inventoryRegisterItemsFirst");
  const productPlaceholder = !hasLoadedProducts
    ? translate("inventoryProductsUnavailable")
    : products.length ? translate("inventorySelectProduct") : translate("inventoryNoProducts");
  const supplierOptions = suppliers.map((supplier) =>
    `<option value="${escapeHtml(supplier.id)}">${escapeHtml(supplier.name)}</option>`
  ).join("");

  ["movementItem", "recipeItem", "transferItem", "reorderItem"].forEach((id) => {
    const select = document.getElementById(id);
    const previousValue = select.value;
    select.innerHTML = `<option value="">${itemPlaceholder}</option>${itemOptions}`;
    if (items.some((item) => item.id === previousValue)) select.value = previousValue;
    select.disabled = !hasLoadedInventory || activeItems().length === 0;
  });

  const supplierSelect = document.getElementById("purchaseSupplier");
  const previousSupplier = supplierSelect.value;
  const noSupplier = hasLoadedSuppliers
    ? translate("No supplier")
    : translate("inventorySuppliersUnavailable");
  supplierSelect.innerHTML = `<option value="">${noSupplier}</option>${supplierOptions}`;
  if (suppliers.some((supplier) => supplier.id === previousSupplier)) supplierSelect.value = previousSupplier;
  supplierSelect.disabled = !hasLoadedSuppliers;

  renderLocationOptions();

  const productSelect = document.getElementById("recipeProduct");
  const previousProduct = productSelect.value;
  productSelect.innerHTML = `<option value="">${productPlaceholder}</option>${products.map((product) =>
    `<option value="${escapeHtml(product.id)}">${escapeHtml(product.name)}</option>`
  ).join("")}`;
  if (products.some((product) => product.id === previousProduct)) productSelect.value = previousProduct;
  productSelect.disabled = !hasLoadedProducts || products.length === 0;
  const productionProduct = document.getElementById("productionProduct");
  const previousProductionProduct = productionProduct.value;
  productionProduct.innerHTML = `<option value="">${productPlaceholder}</option>${products.map((product) => `<option value="${escapeHtml(product.id)}">${escapeHtml(product.name)}</option>`).join("")}`;
  if (products.some((product) => product.id === previousProductionProduct)) productionProduct.value = previousProductionProduct;
  productionProduct.disabled = !hasLoadedProducts || products.length === 0;
  if (productionProduct.value && productionRecipeProductId !== productionProduct.value) void checkProductionRecipe(productionProduct.value);
  else updateProductionAvailability();

  document.getElementById("movementSubmit").disabled = !hasLoadedInventory || activeItems().length === 0;
  document.getElementById("purchaseSubmit").disabled = !hasLoadedInventory || activeItems().length === 0;
  document.getElementById("addPurchaseLine").disabled = !hasLoadedInventory || activeItems().length === 0;
  document.getElementById("createPurchaseOrder").disabled = !hasLoadedInventory || activeItems().length === 0 || !hasLoadedLocations;
  updateRecipeSubmitState();
  document.getElementById("addRecipeIngredient").disabled = !hasLoadedInventory || activeItems().length === 0 || !recipeLoaded;
  renderPurchaseLines();
  renderRecipeUnitOptions();
};

const renderLocationOptions = () => {
  const activeLocations = locations.filter((location) => location.active !== false && location.active !== 0);
  for (const id of ["itemLocation", "movementLocation", "purchaseLocation", "inventoryLocationFilter", "transferFrom", "transferTo", "reorderLocation", "stockCountLocation", "productionLocation"]) {
    const select = document.getElementById(id);
    const previousValue = select.value;
    const includeAll = id === "inventoryLocationFilter";
    const placeholder = includeAll ? `<option value="">${translate("allLocations")}</option>` : `<option value="">${translate("inventoryLocations")}</option>`;
    select.innerHTML = placeholder + activeLocations.map((location) => `<option value="${escapeHtml(location.id)}">${escapeHtml(location.name)} (${escapeHtml(location.code)})</option>`).join("");
    if (activeLocations.some((location) => location.id === previousValue)) select.value = previousValue;
    else if (!includeAll && activeLocations.length) select.value = activeLocations.find((location) => location.code === "MAIN")?.id || activeLocations[0].id;
    select.disabled = !hasLoadedLocations || (!includeAll && locations.length === 0);
  }
  locationList.innerHTML = locations.map((location) => `<li><strong>${escapeHtml(location.name)}</strong><span>${escapeHtml(location.code)}</span></li>`).join("");
  const transferTo = document.getElementById("transferTo");
  if (activeLocations.length > 1 && transferTo.value === document.getElementById("transferFrom").value) transferTo.value = activeLocations.find((location) => location.id !== document.getElementById("transferFrom").value)?.id || "";
  document.getElementById("transferSubmit").disabled = !hasLoadedLocations || !hasLoadedInventory || locations.filter((location) => location.active !== false && location.active !== 0).length < 2 || activeItems().length === 0;
  const transferAvailability = document.getElementById("transferAvailability");
  const canCheckTransfer = hasLoadedLocations && hasLoadedInventory;
  const transferLocationCount = activeLocations.length;
  transferAvailability.hidden = !canCheckTransfer || (transferLocationCount >= 2 && activeItems().length > 0);
  if (canCheckTransfer && transferLocationCount < 2) transferAvailability.textContent = translate("inventoryTransferNeedsLocations");
  else if (canCheckTransfer && activeItems().length === 0) transferAvailability.textContent = translate("inventoryTransferNeedsItems");
  document.getElementById("reorderSubmit").disabled = !hasLoadedLocations || !hasLoadedInventory || activeItems().length === 0;
  document.getElementById("stockCountSubmit").disabled = !hasLoadedLocations || !hasLoadedInventory;
  updateProductionAvailability();
};

document.getElementById("locationForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("[type='submit']");
  button.disabled = true;
  try {
    await apiRequest(`/businesses/${businessId}/inventory/locations`, {
      method: "POST",
      body: { name: document.getElementById("locationName").value.trim(), code: document.getElementById("locationCode").value.trim().toUpperCase() },
    });
    form.reset();
    await load();
    showSuccess(translate("inventoryLocationAdded"));
  } catch {
    showFailure(translate("inventoryLocationAddError"));
  } finally { button.disabled = false; }
});

const renderPurchaseLines = () => {
  const placeholder = !hasLoadedInventory ? translate("inventoryItemsUnavailable") : activeItems().length ? translate("inventorySelectItem") : translate("inventoryRegisterItemsFirst");
  for (const select of purchaseLineList.querySelectorAll("[data-purchase-item]")) {
    const previousValue = select.value;
    select.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>${optionsForItems()}`;
    if (activeItems().some((item) => item.id === previousValue)) select.value = previousValue;
    select.disabled = !hasLoadedInventory || activeItems().length === 0;
  }
  const lines = [...purchaseLineList.querySelectorAll("[data-purchase-line]")];
  lines.forEach((line) => { line.querySelector("[data-remove-purchase-line]").disabled = lines.length === 1; });
};

const addPurchaseLine = () => {
  const line = document.createElement("div");
  line.className = "purchase-line";
  line.dataset.purchaseLine = "";
  line.innerHTML = `<label><span>${escapeHtml(translate("ingredient"))}</span><select data-purchase-item required><option value=""></option></select></label><label><span>${escapeHtml(translate("quantity"))}</span><input data-purchase-quantity type="number" min="0.001" step="0.001" required inputmode="decimal"></label><label><span>${escapeHtml(translate("inventoryCostPerUnit"))}</span><input data-purchase-unit-cost type="number" min="0" step="0.0001" required inputmode="decimal"></label><label><span>${escapeHtml(translate("inventorySupplierLot"))}</span><input data-purchase-lot maxlength="120"></label><label><span>${escapeHtml(translate("inventoryExpiry"))}</span><input data-purchase-expiry type="date"></label><button class="btn btn--secondary purchase-line__remove" type="button" data-remove-purchase-line aria-label="${escapeHtml(translate("Remove"))}">×</button>`;
  purchaseLineList.append(line);
  renderPurchaseLines();
};

document.getElementById("addPurchaseLine").addEventListener("click", addPurchaseLine);
purchaseLineList.addEventListener("click", (event) => {
  if (!event.target.closest("[data-remove-purchase-line]")) return;
  const lines = purchaseLineList.querySelectorAll("[data-purchase-line]");
  if (lines.length > 1) event.target.closest("[data-purchase-line]").remove();
  renderPurchaseLines();
});

const recipeUnitFamily = (unit) => ["g", "kg"].includes(unit) ? "mass" : ["ml", "l"].includes(unit) ? "volume" : unit;
const recipeUnitChoices = (unit) => unit === "kg" ? ["kg", "g"] : unit === "g" ? ["g", "kg"] : unit === "l" ? ["l", "ml"] : unit === "ml" ? ["ml", "l"] : ["unit"];
const renderRecipeUnitOptions = () => {
  const unitSelect = document.getElementById("recipeQuantityUnit");
  const ingredient = activeItems().find((item) => item.id === document.getElementById("recipeItem").value);
  const choices = ingredient ? recipeUnitChoices(ingredient.unit) : ["unit"];
  const current = unitSelect.value;
  unitSelect.innerHTML = choices.map((unit) => `<option value="${unit}">${escapeHtml(formatInventoryUnit(unit))}</option>`).join("");
  unitSelect.disabled = !ingredient;
  if (choices.includes(current)) unitSelect.value = current;
  else if (ingredient) unitSelect.value = ingredient.unit;
};

const renderRecipeIngredients = () => {
  recipeIngredientsList.innerHTML = recipeIngredients.map((ingredient) => `
    <li>
      <span>${escapeHtml(ingredient.name)} · ${formatNumber(ingredient.quantity)} ${escapeHtml(formatInventoryUnit(ingredient.unit))}</span>
      <button class="btn btn--secondary" type="button" data-remove-recipe-item="${escapeHtml(ingredient.id)}" aria-label="${escapeHtml(translate("removeRecipeIngredient").replace("$1", ingredient.name))}">${translate("Remove")}</button>
    </li>
  `).join("");
  updateRecipeSubmitState();
};

const loadRecipe = async (productId, { discardDraft = false } = {}) => {
  if (recipeDirty && !discardDraft && !window.confirm(translate("inventoryRecipeDiscardDraftConfirm"))) {
    document.getElementById("recipeProduct").value = loadedRecipeProductId;
    return false;
  }
  loadedRecipeProductId = productId;
  recipeLoaded = false;
  recipeDirty = false;
  recipeRevision = null;
  recipeIngredients = [];
  renderRecipeIngredients();
  renderSelectOptions();
  const requestSequence = ++recipeLoadSequence;
  if (!productId) return true;
  try {
    const result = await apiRequest(`/businesses/${businessId}/products/${encodeURIComponent(productId)}/recipe`);
    if (requestSequence !== recipeLoadSequence) return false;
    recipeRevision = result.revision;
    recipeIngredients = (Array.isArray(result.ingredients) ? result.ingredients : []).map((entry) => ({
      id: entry.inventory_item_id,
      name: entry.name,
      unit: entry.unit,
      quantity: Number(entry.quantity),
    }));
    recipeLoaded = true;
    renderRecipeIngredients();
    renderSelectOptions();
    return true;
  } catch {
    if (requestSequence === recipeLoadSequence) showFailure(translate("inventoryRecipeLoadError"));
    return false;
  }
};

document.getElementById("recipeProduct").addEventListener("change", (event) => {
  void loadRecipe(event.currentTarget.value);
});
document.getElementById("recipeItem").addEventListener("change", renderRecipeUnitOptions);
document.getElementById("productionProduct").addEventListener("change", (event) => {
  void checkProductionRecipe(event.currentTarget.value);
});

const renderInventory = () => {
  if (!hasLoadedInventory) return;
  rows.setAttribute("aria-busy", "false");
  count.hidden = false;
  const query = inventorySearchQuery.trim().toLocaleLowerCase(getLocale());
  const visibleItems = query
    ? displayItems.filter((item) => String(item.name || "").toLocaleLowerCase(getLocale()).includes(query))
    : displayItems;
  count.textContent = query
    ? translate("$1 of $2 ingredients found").replace("$1", formatNumber(visibleItems.length)).replace("$2", formatNumber(displayItems.length))
    : `${formatNumber(displayItems.length)} ${translate(displayItems.length === 1 ? "ingredient" : "ingredients")}`;
  if (!displayItems.length) {
    rows.innerHTML = `<tr><td class="inventory-empty" colspan="6">${translate("noItems")}</td></tr>`;
    return;
  }

  if (!visibleItems.length) {
    rows.innerHTML = `<tr><td class="inventory-empty" colspan="6">${translate("No ingredients match your search")}</td></tr>`;
    return;
  }

  rows.innerHTML = visibleItems.map((item) => {
    const current = Number(item.current_quantity || 0);
    const minimum = Number(item.minimum_quantity || 0);
    const isBelowMinimum = current < minimum;
    const isAtMinimum = minimum > 0 && current === minimum;
    const isInactive = !isItemActive(item);
    const status = isInactive ? translate("inactive") : isBelowMinimum
      ? translate("belowMinimum")
      : isAtMinimum ? translate("atMinimum") : translate("normal");
    const statusClass = isInactive ? "is-inactive" : isBelowMinimum ? "is-low" : isAtMinimum ? "is-at-minimum" : "";
    return `
      <tr>
        <td><strong>${escapeHtml(item.name)}</strong></td>
        <td>${escapeHtml(formatInventoryUnit(item.unit))}</td>
        <td>${formatNumber(current)}</td>
        <td>${formatNumber(minimum)}</td>
        <td><span class="inventory-table__status ${statusClass}">${escapeHtml(status)}</span></td>
        <td><button class="btn btn--secondary" type="button" data-inventory-active="${isInactive ? "true" : "false"}" data-inventory-id="${escapeHtml(item.id)}">${translate(isInactive ? "inventoryReactivateItem" : "inventoryArchive")}</button></td>
      </tr>
    `;
  }).join("");
};

const renderMovementHistory = () => {
  movementRows.setAttribute("aria-busy", "false");
  movementCount.textContent = formatNumber(totalMovements);
  if (!movements.length) {
    movementRows.innerHTML = `<tr><td class="inventory-empty" colspan="6">${translate("inventoryNoMovements")}</td></tr>`;
    return;
  }
  const movementLabels = { purchase: "Purchase", adjustment: "Adjustment", loss: "Waste", sale: "Sale" };
  movementRows.innerHTML = movements.map((movement) => {
    const date = parseApiTimestamp(movement.created_at);
    const dateLabel = Number.isNaN(date.getTime()) ? "—" : date.toLocaleString(getLocale());
    const trace = [movement.location_name, movement.lot_code].filter(Boolean).join(" · ") || "—";
    return `<tr><td><strong>${escapeHtml(movement.inventory_item_name)}</strong></td><td>${escapeHtml(translate(movementLabels[movement.type] || movement.type))}</td><td>${formatNumber(movement.quantity)} ${escapeHtml(formatInventoryUnit(movement.inventory_item_unit))}</td><td>${escapeHtml(trace)}</td><td>${escapeHtml(dateLabel)}</td><td>${escapeHtml(movement.description || "—")}</td></tr>`;
  }).join("");
};

const renderPurchaseHistory = () => {
  purchaseRows.setAttribute("aria-busy", "false");
  purchaseCount.textContent = formatNumber(totalPurchases);
  if (!purchases.length) {
    purchaseRows.innerHTML = `<tr><td class="inventory-empty" colspan="5">${translate("inventoryNoPurchases")}</td></tr>`;
    return;
  }
  const currency = new Intl.NumberFormat(getLocale(), { style: "currency", currency: "BRL" });
  purchaseRows.innerHTML = purchases.map((purchase) => {
    const date = parseApiTimestamp(purchase.received_at);
    const dateLabel = Number.isNaN(date.getTime()) ? "—" : date.toLocaleString(getLocale());
    const itemSummary = purchase.items.map((item) => `${item.name}: ${formatNumber(item.quantity)} ${formatInventoryUnit(item.unit)}${item.lot_code ? ` · ${translate("inventoryLot")}: ${item.lot_code}` : ""}${item.expires_at ? ` · ${translate("inventoryExpiry")}: ${item.expires_at}` : ""}`).join("; ");
    return `<tr><td>${escapeHtml(dateLabel)}</td><td>${escapeHtml(purchase.supplier_name || "—")}</td><td>${escapeHtml(itemSummary || "—")}</td><td>${escapeHtml(currency.format(Number(purchase.total_cost || 0)))}</td><td>${escapeHtml(translate(purchase.status || "received"))}</td></tr>`;
  }).join("");
};

const renderPurchaseOrders = () => {
  const target = document.getElementById("purchaseOrderRows");
  if (!purchaseOrders.length) { target.innerHTML = `<tr><td colspan="5" class="inventory-empty">${translate("inventoryNoPurchaseOrders")}</td></tr>`; return; }
  const labels = { ordered: translate("inventoryPurchaseOrdered"), partial: translate("inventoryPurchasePartial"), received: translate("inventoryPurchaseReceived"), cancelled: translate("inventoryPurchaseCancelled") };
  target.innerHTML = purchaseOrders.map((order) => {
    const summary = order.items.map((item) => `${escapeHtml(item.inventory_item_name)}: ${formatNumber(item.received_quantity)} / ${formatNumber(item.ordered_quantity)} ${escapeHtml(formatInventoryUnit(item.unit))}`).join("<br>");
    const receipts = order.receipts.map((receipt) => {
      const state = receipt.status === "reversed" ? translate("inventoryReceiptReversedStatus") : translate("inventoryPurchaseReceived");
      const action = receipt.status === "received" ? ` <button class="btn btn--secondary" type="button" data-purchase-action="reverse" data-receipt-id="${escapeHtml(receipt.id)}">${translate("inventoryReverseReceipt")}</button>` : "";
      return `${escapeHtml(receipt.id.slice(0, 8))}: ${escapeHtml(state)}${action}`;
    }).join("<br>");
    const controls = ["ordered", "partial"].includes(order.status)
      ? `<button class="btn btn--secondary" type="button" data-purchase-action="receive" data-order-id="${escapeHtml(order.id)}">${translate("inventoryReceiveShipment")}</button> <button class="btn btn--secondary" type="button" data-purchase-action="cancel" data-order-id="${escapeHtml(order.id)}">${translate("inventoryCancelPurchaseOrder")}</button>` : "";
    return `<tr><td>${escapeHtml(order.supplier_name || "—")}</td><td>${escapeHtml(order.location_name)}</td><td>${escapeHtml(labels[order.status] || order.status)}</td><td>${summary}</td><td>${controls}${receipts ? `<br>${receipts}` : "—"}</td></tr>`;
  }).join("");
};

const renderTransferHistory = () => {
  const target = document.getElementById("transferRows");
  if (!transfers.length) { target.innerHTML = `<tr><td colspan="5" class="inventory-empty">${translate("inventoryNoTransfers")}</td></tr>`; return; }
  const labels = { draft: translate("inventoryTransferDraft"), in_transit: translate("inventoryTransferInTransit"), received: translate("inventoryTransferReceived"), cancelled: translate("inventoryTransferCancelled") };
  target.innerHTML = transfers.map((transfer) => {
    const actions = transfer.status === "draft" ? `<button class="btn btn--secondary" type="button" data-transfer-action="in_transit" data-transfer-id="${escapeHtml(transfer.id)}">${translate("inventoryTransferShip")}</button>`
      : transfer.status === "in_transit" ? `<button class="btn btn--secondary" type="button" data-transfer-action="received" data-transfer-id="${escapeHtml(transfer.id)}">${translate("inventoryTransferReceive")}</button>` : "—";
    const summary = transfer.items.map((item) => `${escapeHtml(item.name)}: ${formatNumber(item.quantity)} ${escapeHtml(formatInventoryUnit(item.unit))} · ${escapeHtml(item.lot_code)}`).join("<br>");
    return `<tr><td>${escapeHtml(transfer.id.slice(0, 8))}</td><td>${escapeHtml(transfer.from_location_name)} → ${escapeHtml(transfer.to_location_name)}</td><td>${escapeHtml(labels[transfer.status] || transfer.status)}</td><td>${summary || "—"}</td><td>${actions}</td></tr>`;
  }).join("");
};

const renderReorderAlerts = () => {
  const target = document.getElementById("reorderRows");
  if (!reorderAlerts.length) { target.innerHTML = `<tr><td colspan="5" class="inventory-empty">${translate("inventoryNoReorderAlerts")}</td></tr>`; return; }
  target.innerHTML = reorderAlerts.map((item) => `<tr><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.location_name)}</td><td>${formatNumber(item.current_quantity)} ${escapeHtml(formatInventoryUnit(item.unit))}</td><td>${formatNumber(item.minimum_quantity)}</td><td>${formatNumber(item.reorder_quantity)}</td></tr>`).join("");
};

const renderLots = () => {
  const target = document.getElementById("inventoryLotRows");
  if (!inventoryLots.length) { target.innerHTML = `<tr><td colspan="7" class="inventory-empty">${translate("inventoryNoLots")}</td></tr>`; return; }
  target.innerHTML = inventoryLots.map((lot) => {
    const status = lot.status === "active" ? translate("inventoryLotActive") : lot.status === "quarantined" ? translate("inventoryLotQuarantined") : lot.status === "recalled" ? translate("inventoryLotRecalled") : lot.status;
    const expired = Number(lot.is_expired) === 1;
    const actions = lot.status === "active"
      ? `<button class="btn btn--secondary" type="button" data-lot-status="quarantined" data-lot-id="${escapeHtml(lot.id)}">${translate("inventoryLotQuarantine")}</button> <button class="btn btn--secondary" type="button" data-lot-status="recalled" data-lot-id="${escapeHtml(lot.id)}">${translate("inventoryLotRecall")}</button>`
      : lot.status === "quarantined" ? `<button class="btn btn--secondary" type="button" data-lot-status="active" data-lot-id="${escapeHtml(lot.id)}">${translate("inventoryLotReactivate")}</button> <button class="btn btn--secondary" type="button" data-lot-status="recalled" data-lot-id="${escapeHtml(lot.id)}">${translate("inventoryLotRecall")}</button>` : "—";
    return `<tr class="${expired ? "is-expired" : ""}"><td>${escapeHtml(lot.inventory_item_name)}</td><td>${escapeHtml(lot.lot_code)}</td><td>${escapeHtml(lot.location_name)}</td><td>${escapeHtml(lot.expires_at?.slice(0, 10) || "—")}${expired ? ` · ${translate("inventoryLotExpired")}` : ""}</td><td>${formatNumber(lot.current_quantity)} ${escapeHtml(formatInventoryUnit(lot.unit))}</td><td>${escapeHtml(status)}</td><td>${actions}</td></tr>`;
  }).join("");
};

const renderStockCounts = () => {
  const target = document.getElementById("stockCountRows");
  if (!stockCounts.length) { target.innerHTML = `<tr><td colspan="5" class="inventory-empty">${translate("inventoryNoStockCounts")}</td></tr>`; return; }
  const labels = { draft: translate("inventoryCountDraft"), submitted: translate("inventoryCountSubmittedStatus"), approved: translate("inventoryCountApprovedStatus"), rejected: translate("inventoryCountRejected") };
  target.innerHTML = stockCounts.map((count) => {
    const action = count.status === "submitted" ? `<button class="btn btn--secondary" type="button" data-stock-count-action="approved" data-stock-count-id="${escapeHtml(count.id)}">${translate("inventoryApproveCount")}</button>`
      : count.status === "draft" ? `<button class="btn btn--secondary" type="button" data-stock-count-action="resume" data-stock-count-id="${escapeHtml(count.id)}">${translate("inventoryResumeCount")}</button> <button class="btn btn--secondary" type="button" data-stock-count-action="delete" data-stock-count-id="${escapeHtml(count.id)}">${translate("inventoryDiscardDraft")}</button>` : "—";
    const date = parseApiTimestamp(count.started_at);
    return `<tr><td>${escapeHtml(count.location_name)}</td><td>${escapeHtml(labels[count.status] || count.status)}</td><td>${escapeHtml(Number.isNaN(date.getTime()) ? "—" : date.toLocaleString(getLocale()))}</td><td>${formatNumber(count.item_count)}</td><td>${action}</td></tr>`;
  }).join("");
};

const renderProductionOrders = () => {
  const target = document.getElementById("productionRows");
  if (!productionOrders.length) { target.innerHTML = `<tr><td colspan="10" class="inventory-empty">${translate("inventoryNoProduction")}</td></tr>`; return; }
  const labels = { planned: translate("inventoryProductionPlanned"), in_progress: translate("inventoryProductionInProgress"), completed: translate("inventoryProductionDone"), cancelled: translate("inventoryTransferCancelled") };
  target.innerHTML = productionOrders.map((order) => {
    const action = order.status === "planned" ? `<button class="btn btn--secondary" type="button" data-production-action="in_progress" data-production-id="${escapeHtml(order.id)}">${translate("inventoryStartProduction")}</button> <button class="btn btn--secondary" type="button" data-production-action="cancelled" data-production-id="${escapeHtml(order.id)}">${translate("inventoryCancelProduction")}</button>`
      : order.status === "in_progress" ? `<button class="btn btn--secondary" type="button" data-production-action="completed" data-production-id="${escapeHtml(order.id)}">${translate("inventoryCompleteProduction")}</button> <button class="btn btn--secondary" type="button" data-production-action="cancelled" data-production-id="${escapeHtml(order.id)}">${translate("inventoryCancelProduction")}</button>` : "—";
    const lotActions = order.stock_quantity > 0 && order.stock_lot_status === "active"
      ? `<button class="btn btn--secondary" type="button" data-product-lot-status="quarantined" data-product-lot-id="${escapeHtml(order.stock_lot_id)}">${translate("inventoryLotQuarantine")}</button> <button class="btn btn--secondary" type="button" data-product-lot-status="recalled" data-product-lot-id="${escapeHtml(order.stock_lot_id)}">${translate("inventoryLotRecall")}</button>`
      : order.stock_quantity > 0 && order.stock_lot_status === "quarantined" ? `<button class="btn btn--secondary" type="button" data-product-lot-status="active" data-product-lot-id="${escapeHtml(order.stock_lot_id)}">${translate("inventoryLotReactivate")}</button> <button class="btn btn--secondary" type="button" data-product-lot-status="recalled" data-product-lot-id="${escapeHtml(order.stock_lot_id)}">${translate("inventoryLotRecall")}</button>` : "";
    const actual = order.actual_quantity === null ? "—" : `${formatNumber(order.actual_quantity)} (${formatNumber(order.yield_percent)}%)`;
    const expiry = order.expires_at?.slice(0, 10) || "—";
    const expired = Number(order.is_expired) === 1;
    return `<tr class="${expired ? "is-expired" : ""}"><td>${escapeHtml(order.batch_code)}</td><td>${escapeHtml(order.product_name)}</td><td>${escapeHtml(order.location_name || "—")}</td><td>${escapeHtml(labels[order.status] || order.status)}</td><td>${formatNumber(order.planned_quantity)}</td><td>${actual}</td><td>${formatNumber(order.waste_quantity)}</td><td>${escapeHtml(expiry)}${expired ? ` · ${translate("inventoryLotExpired")}` : ""}</td><td>${formatNumber(order.available_quantity)}</td><td>${action} ${lotActions}</td></tr>`;
  }).join("");
};

inventorySearch.addEventListener("input", (event) => {
  inventorySearchQuery = event.currentTarget.value || "";
  renderInventory();
});
inventoryLocationFilter.addEventListener("change", async () => {
  const requestSequence = ++locationFilterRequestSequence;
  const selectedLocation = inventoryLocationFilter.value;
  rows.setAttribute("aria-busy", "true");
  try {
    const query = selectedLocation ? `?location_id=${encodeURIComponent(selectedLocation)}` : "";
    const result = await apiRequest(`/businesses/${businessId}/inventory/balances${query}`);
    if (requestSequence !== locationFilterRequestSequence) return;
    displayItems = Array.isArray(result.items) ? result.items : [];
    loadedInventoryLocationFilter = selectedLocation;
    renderInventory();
  } catch {
    if (requestSequence !== locationFilterRequestSequence) return;
    inventoryLocationFilter.value = loadedInventoryLocationFilter;
    rows.setAttribute("aria-busy", "false");
    showFailure(translate("inventoryNotAvailable"));
  }
});

rows.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-inventory-active]");
  if (!button) return;
  button.disabled = true;
  const active = button.dataset.inventoryActive === "true";
  try {
    await apiRequest(`/businesses/${businessId}/inventory/items/${encodeURIComponent(button.dataset.inventoryId)}`, { method: "PATCH", body: { active } });
    await load();
    showSuccess(translate(active ? "inventoryItemReactivated" : "inventoryItemArchived"));
  } catch (error) { showFailure(error?.message || translate("inventoryItemArchiveError")); button.disabled = false; }
});

const load = async () => {
  if (loading) return false;
  loading = true;
  const locationSequenceAtLoad = locationFilterRequestSequence;
  const locationFilterAtLoad = inventoryLocationFilter.value;
  hideLoadError();
  setLoading(true);
  if (!hasLoadedInventory) {
    count.textContent = "—";
    rows.setAttribute("aria-busy", "true");
    rows.replaceChildren();
  }
  try {
    const results = await Promise.allSettled([
      apiRequest(`/businesses/${businessId}/inventory/items`),
      apiRequest(`/businesses/${businessId}/inventory/movements?limit=50&offset=0`),
      apiRequest(`/businesses/${businessId}/purchases?limit=50&offset=0`),
      apiRequest(`/businesses/${businessId}/inventory/locations`),
      apiRequest(`/businesses/${businessId}/inventory/balances${locationFilterAtLoad ? `?location_id=${encodeURIComponent(locationFilterAtLoad)}` : ""}`),
      apiRequest(`/businesses/${businessId}/products`),
      apiRequest(`/businesses/${businessId}/suppliers`),
      apiRequest(`/businesses/${businessId}/inventory/transfers`),
      apiRequest(`/businesses/${businessId}/inventory/reorder`),
      apiRequest(`/businesses/${businessId}/inventory/lots`),
      apiRequest(`/businesses/${businessId}/inventory/stock-counts`),
      apiRequest(`/businesses/${businessId}/inventory/production-orders`),
      apiRequest(`/businesses/${businessId}/inventory/purchase-orders`),
    ]);
    const [inventoryResult, movementsResult, purchasesResult, locationsResult, balancesResult, productResult, supplierResult, transfersResult, reorderResult, lotsResult, stockCountsResult, productionResult, purchaseOrdersResult] = results;
    let hasLoadError = false;

    if (inventoryResult.status === "fulfilled") {
      items = Array.isArray(inventoryResult.value.items) ? inventoryResult.value.items : [];
      hasLoadedInventory = true;
      inventorySearch.disabled = false;
      renderInventory();
    } else {
      hasLoadError = true;
      if (!hasLoadedInventory) {
        inventorySearch.disabled = true;
        count.textContent = "";
        count.hidden = true;
        rows.setAttribute("aria-busy", "false");
        rows.innerHTML = `<tr><td class="inventory-empty" colspan="6">${translate("inventoryNotAvailable")}</td></tr>`;
      }
    }

    if (locationsResult.status === "fulfilled") {
      locations = Array.isArray(locationsResult.value.locations) ? locationsResult.value.locations : [];
      hasLoadedLocations = true;
      renderLocationOptions();
    } else {
      hasLoadError = true;
    }

    if (balancesResult.status === "fulfilled") {
      if (locationSequenceAtLoad === locationFilterRequestSequence) {
        displayItems = Array.isArray(balancesResult.value.items) ? balancesResult.value.items : [];
        loadedInventoryLocationFilter = locationFilterAtLoad;
        renderInventory();
      }
    } else {
      hasLoadError = true;
    }

    if (movementsResult.status === "fulfilled") {
      movements = Array.isArray(movementsResult.value.movements) ? movementsResult.value.movements : [];
      totalMovements = Number(movementsResult.value.total || movements.length);
      renderMovementHistory();
    } else {
      hasLoadError = true;
    }

    if (purchasesResult.status === "fulfilled") {
      purchases = Array.isArray(purchasesResult.value.purchases) ? purchasesResult.value.purchases : [];
      totalPurchases = Number(purchasesResult.value.total || purchases.length);
      renderPurchaseHistory();
    } else {
      hasLoadError = true;
    }

    if (productResult.status === "fulfilled") {
      products = Array.isArray(productResult.value.products) ? productResult.value.products : [];
      hasLoadedProducts = true;
    } else {
      hasLoadError = true;
    }

    if (supplierResult.status === "fulfilled") {
      suppliers = Array.isArray(supplierResult.value.suppliers) ? supplierResult.value.suppliers : [];
      hasLoadedSuppliers = true;
    } else {
      hasLoadError = true;
    }

    if (transfersResult.status === "fulfilled") {
      transfers = Array.isArray(transfersResult.value.transfers) ? transfersResult.value.transfers : [];
      renderTransferHistory();
    } else hasLoadError = true;
    if (reorderResult.status === "fulfilled") {
      reorderAlerts = Array.isArray(reorderResult.value.items) ? reorderResult.value.items : [];
      renderReorderAlerts();
    } else hasLoadError = true;
    if (lotsResult.status === "fulfilled") {
      inventoryLots = Array.isArray(lotsResult.value.lots) ? lotsResult.value.lots : [];
      renderLots();
    } else hasLoadError = true;
    if (stockCountsResult.status === "fulfilled") {
      stockCounts = Array.isArray(stockCountsResult.value.stock_counts) ? stockCountsResult.value.stock_counts : [];
      renderStockCounts();
    } else hasLoadError = true;
    if (productionResult.status === "fulfilled") {
      productionOrders = Array.isArray(productionResult.value.production_orders) ? productionResult.value.production_orders : [];
      renderProductionOrders();
    } else hasLoadError = true;
    if (purchaseOrdersResult.status === "fulfilled") {
      purchaseOrders = Array.isArray(purchaseOrdersResult.value.purchase_orders) ? purchaseOrdersResult.value.purchase_orders : [];
      renderPurchaseOrders();
    } else hasLoadError = true;

    renderSelectOptions();
    if (hasLoadError) {
      showLoadError();
      return false;
    }
    return true;
  } catch {
    showLoadError();
    if (!hasLoadedInventory) {
      count.textContent = "";
      count.hidden = true;
      rows.setAttribute("aria-busy", "false");
      rows.innerHTML = `<tr><td class="inventory-empty" colspan="6">${translate("inventoryNotAvailable")}</td></tr>`;
    }
    return false;
  } finally {
    loading = false;
    setLoading(false);
  }
};

retryButton.addEventListener("click", () => void initializeInventory());

movementType.addEventListener("change", () => {
  movementDirectionField.hidden = movementType.value !== "adjustment";
});
movementDirectionField.hidden = movementType.value !== "adjustment";

document.getElementById("inventoryForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('[type="submit"]');
  const output = document.getElementById("inventoryMessage");
  button.disabled = true;
  clearMessage(output);
  try {
    await apiRequest(`/businesses/${businessId}/inventory/items`, {
      method: "POST",
      body: {
        name: document.getElementById("itemName").value.trim(),
        unit: document.getElementById("itemUnit").value,
        location_id: document.getElementById("itemLocation").value,
        current_quantity: Number(document.getElementById("itemQuantity").value),
        minimum_quantity: Number(document.getElementById("itemMinimum").value),
      },
    });
    form.reset();
    await load();
    showSuccess(translate("inventoryItemSaved"));
  } catch {
    showFailure(translate("inventoryItemSaveError"));
  } finally {
    button.disabled = false;
  }
});

document.getElementById("movementForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = document.getElementById("movementSubmit");
  const idempotencyKey = getFormIdempotencyKey(form);
  const type = movementType.value;
  button.disabled = true;
  try {
    await apiRequest(`/businesses/${businessId}/inventory/items/${encodeURIComponent(document.getElementById("movementItem").value)}/movements`, {
      method: "POST",
      idempotencyKey,
      body: {
        type,
        direction: type === "adjustment" ? Number(document.getElementById("movementDirection").value) : 1,
        location_id: document.getElementById("movementLocation").value,
        quantity: Number(document.getElementById("movementQuantity").value),
        description: document.getElementById("movementDescription").value.trim(),
      },
    });
    form.reset();
    movementDirectionField.hidden = movementType.value !== "adjustment";
    await load();
    delete form.dataset.idempotencyKey;
    showSuccess(translate(type === "loss" ? "inventoryLossSaved" : "inventoryAdjustmentSaved"));
  } catch (error) {
    if (error?.status >= 400 && error.status < 500) delete form.dataset.idempotencyKey;
    showFailure(error?.message || translate(type === "loss" ? "inventoryLossSaveError" : "inventoryAdjustmentSaveError"));
  } finally {
    button.disabled = activeItems().length === 0;
  }
});

document.getElementById("purchaseForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = document.getElementById("purchaseSubmit");
  const idempotencyKey = getFormIdempotencyKey(form);
  button.disabled = true;
  try {
    await apiRequest(`/businesses/${businessId}/purchases`, {
      method: "POST",
      idempotencyKey,
      body: {
        supplier_id: document.getElementById("purchaseSupplier").value || null,
        location_id: document.getElementById("purchaseLocation").value,
        items: [...purchaseLineList.querySelectorAll("[data-purchase-line]")].map((line) => ({
          inventory_item_id: line.querySelector("[data-purchase-item]").value,
          quantity: Number(line.querySelector("[data-purchase-quantity]").value),
          unit_cost: Number(line.querySelector("[data-purchase-unit-cost]").value),
          lot_code: line.querySelector("[data-purchase-lot]").value.trim() || null,
          expires_at: line.querySelector("[data-purchase-expiry]").value || null,
        })),
      },
    });
    form.reset();
    await load();
    delete form.dataset.idempotencyKey;
    showSuccess(translate("inventoryPurchaseSaved"));
  } catch (error) {
    if (error?.status >= 400 && error.status < 500) delete form.dataset.idempotencyKey;
    showFailure(error?.message || translate("inventoryPurchaseSaveError"));
  } finally {
    button.disabled = activeItems().length === 0;
  }
});

document.getElementById("createPurchaseOrder").addEventListener("click", async () => {
  const form = document.getElementById("purchaseForm");
  const button = document.getElementById("createPurchaseOrder");
  const lines = [...purchaseLineList.querySelectorAll("[data-purchase-line]")].map((line) => ({
    inventory_item_id: line.querySelector("[data-purchase-item]").value,
    quantity: Number(line.querySelector("[data-purchase-quantity]").value),
    unit_cost: Number(line.querySelector("[data-purchase-unit-cost]").value),
  }));
  if (!form.reportValidity()) return;
  button.disabled = true;
  try {
    await apiRequest(`/businesses/${businessId}/inventory/purchase-orders`, { method: "POST", body: {
      supplier_id: document.getElementById("purchaseSupplier").value || null,
      location_id: document.getElementById("purchaseLocation").value,
      notes: "",
      items: lines,
    } });
    form.reset();
    await load();
    showSuccess(translate("inventoryPurchaseOrderCreated"));
  } catch (error) { showFailure(error?.message || translate("inventoryPurchaseWorkflowError")); }
  finally { button.disabled = !hasLoadedInventory || activeItems().length === 0 || !hasLoadedLocations; }
});

document.getElementById("purchaseOrderRows").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-purchase-action]");
  if (!button) return;
  const action = button.dataset.purchaseAction;
  const order = purchaseOrders.find((entry) => entry.id === button.dataset.orderId);
  if (action === "receive" && !order) return;
  if ((action === "cancel" || action === "reverse") && !window.confirm(action === "reverse" ? translate("inventoryReverseReceipt") + "?" : translate("inventoryCancelPurchaseOrder") + "?")) return;
  button.disabled = true;
  try {
    if (action === "receive") {
      let pendingReceipt = receiptIdempotencyKeys.get(order.id);
      if (!pendingReceipt) {
        const lines = [];
        for (const item of order.items) {
          const remaining = Number((item.ordered_quantity - item.received_quantity).toFixed(3));
          if (remaining <= 0) continue;
          const promptText = translate("inventoryReceiptQuantityPrompt").replace("$1", item.inventory_item_name).replace("$2", formatNumber(remaining));
          const value = window.prompt(promptText, String(remaining));
          if (value === null) { button.disabled = false; return; }
          const quantity = parseInventoryQuantity(value);
          if (quantity === null || quantity > remaining) throw new Error(translate("inventoryCountInvalid").replace("$1", item.inventory_item_name));
          if (quantity === 0) continue;
          const lotCode = window.prompt(translate("inventoryReceiptLotPrompt").replace("$1", item.inventory_item_name), "") || null;
          const expiresAt = window.prompt(translate("inventoryReceiptExpiryPrompt").replace("$1", item.inventory_item_name), "") || null;
          lines.push({ order_item_id: item.id, quantity, lot_code: lotCode, expires_at: expiresAt });
        }
        if (!lines.length) { button.disabled = false; return; }
        pendingReceipt = { key: crypto.randomUUID(), items: lines };
        receiptIdempotencyKeys.set(order.id, pendingReceipt);
      }
      await apiRequest(`/businesses/${businessId}/inventory/purchase-orders/${encodeURIComponent(order.id)}/receipts`, { method: "POST", idempotencyKey: pendingReceipt.key, body: { items: pendingReceipt.items } });
      receiptIdempotencyKeys.delete(order.id);
    } else if (action === "cancel") {
      await apiRequest(`/businesses/${businessId}/inventory/purchase-orders/${encodeURIComponent(button.dataset.orderId)}`, { method: "PATCH", body: { status: "cancelled" } });
    } else {
      await apiRequest(`/businesses/${businessId}/inventory/purchase-receipts/${encodeURIComponent(button.dataset.receiptId)}`, { method: "PATCH", body: { status: "reversed" } });
    }
    await load();
    showSuccess(translate(action === "receive" ? "inventoryPurchaseReceived" : action === "cancel" ? "inventoryPurchaseOrderCancelled" : "inventoryReceiptReversed"));
  } catch (error) {
    if (action === "receive" && error?.status >= 400 && error.status < 500) receiptIdempotencyKeys.delete(order.id);
    showFailure(error?.message || translate("inventoryPurchaseWorkflowError"));
    button.disabled = false;
  }
});

document.getElementById("transferForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = document.getElementById("transferSubmit");
  button.disabled = true;
  try {
    await apiRequest(`/businesses/${businessId}/inventory/transfers`, { method: "POST", body: {
      from_location_id: document.getElementById("transferFrom").value,
      to_location_id: document.getElementById("transferTo").value,
      notes: document.getElementById("transferNotes").value.trim(),
      items: [{ inventory_item_id: document.getElementById("transferItem").value, quantity: Number(document.getElementById("transferQuantity").value) }],
    } });
    form.reset();
    await load();
    showSuccess(translate("inventoryTransferCreated"));
  } catch (error) { showFailure(error?.message || translate("inventoryTransferError")); }
  finally { button.disabled = !hasLoadedLocations || activeItems().length === 0; }
});

document.getElementById("transferRows").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-transfer-action]");
  if (!button) return;
  button.disabled = true;
  try {
    await apiRequest(`/businesses/${businessId}/inventory/transfers/${encodeURIComponent(button.dataset.transferId)}`, { method: "PATCH", body: { status: button.dataset.transferAction } });
    await load();
    showSuccess(button.dataset.transferAction === "in_transit" ? translate("inventoryTransferShipped") : translate("inventoryTransferReceivedDone"));
  } catch (error) { showFailure(error?.message || translate("inventoryTransferError")); button.disabled = false; }
});

document.getElementById("inventoryLotRows").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-lot-status]");
  if (!button) return;
  const status = button.dataset.lotStatus;
  if (status === "recalled" && !window.confirm(translate("inventoryLotRecallConfirm"))) return;
  button.disabled = true;
  try {
    await apiRequest(`/businesses/${businessId}/inventory/lots/${encodeURIComponent(button.dataset.lotId)}`, { method: "PATCH", body: { status } });
    await load();
    showSuccess(status === "recalled" ? translate("inventoryLotRecalledDone") : status === "quarantined" ? translate("inventoryLotQuarantinedDone") : translate("inventoryLotReactivatedDone"));
  } catch (error) { showFailure(error?.message || translate("inventoryLotUpdateError")); button.disabled = false; }
});

document.getElementById("reorderForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = document.getElementById("reorderSubmit");
  button.disabled = true;
  try {
    await apiRequest(`/businesses/${businessId}/inventory/reorder-settings`, { method: "PUT", body: { items: [{
      location_id: document.getElementById("reorderLocation").value,
      inventory_item_id: document.getElementById("reorderItem").value,
      minimum_quantity: Number(document.getElementById("reorderMinimum").value),
      reorder_quantity: Number(document.getElementById("reorderQuantity").value),
      lead_time_days: Number(document.getElementById("reorderLeadTime").value),
    }] } });
    await load();
    showSuccess(translate("inventoryReorderSaved"));
  } catch (error) { showFailure(error?.message || translate("inventoryReorderError")); }
  finally { button.disabled = !hasLoadedLocations || activeItems().length === 0; }
});

document.getElementById("productionForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = document.getElementById("productionSubmit");
  button.disabled = true;
  try {
    const result = await apiRequest(`/businesses/${businessId}/inventory/production-orders`, { method: "POST", body: {
      product_id: document.getElementById("productionProduct").value,
      location_id: document.getElementById("productionLocation").value,
      batch_code: document.getElementById("productionBatch").value.trim(),
      planned_quantity: Number(document.getElementById("productionPlanned").value),
      expires_at: document.getElementById("productionExpiry").value || null,
    } });
    const output = document.getElementById("productionMessage");
    output.textContent = `${translate("inventoryProductionCreated")}: ${result.production_order.batch_code}`;
    output.hidden = false;
    event.currentTarget.reset();
    await load();
  } catch (error) { showFailure(error?.message || translate("inventoryProductionError")); }
  finally { button.disabled = !hasLoadedProducts || products.length === 0; }
});

document.getElementById("productionRows").addEventListener("click", async (event) => {
  const lotButton = event.target.closest("[data-product-lot-status]");
  if (lotButton) {
    const lotStatus = lotButton.dataset.productLotStatus;
    if (lotStatus === "recalled" && !window.confirm(translate("inventoryLotRecallConfirm"))) return;
    lotButton.disabled = true;
    try {
      await apiRequest(`/businesses/${businessId}/inventory/product-lots/${encodeURIComponent(lotButton.dataset.productLotId)}`, { method: "PATCH", body: { status: lotStatus } });
      await load();
      showSuccess(translate(lotStatus === "recalled" ? "inventoryLotRecalledDone" : lotStatus === "quarantined" ? "inventoryLotQuarantinedDone" : "inventoryLotReactivatedDone"));
    } catch (error) { showFailure(error?.message || translate("inventoryLotUpdateError")); lotButton.disabled = false; }
    return;
  }
  const button = event.target.closest("[data-production-action]");
  if (!button) return;
  const action = button.dataset.productionAction;
  const order = productionOrders.find((entry) => entry.id === button.dataset.productionId);
  if (!order) return;
  let body = { status: action };
  if (action === "completed") {
    const promptText = translate("inventoryProductionActualPrompt").replace("$1", order.batch_code);
    const value = window.prompt(promptText, String(order.planned_quantity));
    if (value === null) return;
    body.actual_quantity = Number(value.trim().replace(",", "."));
  }
  if (action === "cancelled" && !window.confirm(translate("inventoryCancelConfirmation"))) return;
  button.disabled = true;
  try {
    await apiRequest(`/businesses/${businessId}/inventory/production-orders/${encodeURIComponent(order.id)}`, { method: "PATCH", body });
    await load();
    showSuccess(translate(action === "in_progress" ? "inventoryProductionStarted" : action === "completed" ? "inventoryProductionCompleted" : "inventoryProductionCancelled"));
  } catch (error) { showFailure(error?.message || translate("inventoryProductionError")); button.disabled = false; }
});

const enterStockCount = async (countId) => {
  const snapshot = await apiRequest(`/businesses/${businessId}/inventory/stock-counts/${encodeURIComponent(countId)}`);
  const countedItems = [];
  for (const item of snapshot.stock_count.items) {
    const promptText = translate("inventoryCountExpectedPrompt").replace("$1", item.name).replace("$2", formatNumber(item.expected_quantity)).replace("$3", formatInventoryUnit(item.unit));
    const value = window.prompt(promptText, String(item.counted_quantity ?? item.expected_quantity));
    if (value === null) return false;
    const quantity = parseInventoryQuantity(value);
    if (quantity === null) throw new Error(translate("inventoryCountInvalid").replace("$1", item.name));
    const reasonPrompt = translate("inventoryCountReasonPrompt").replace("$1", item.name);
    const reason = quantity !== item.expected_quantity ? window.prompt(reasonPrompt, item.variance_reason || "") : "";
    countedItems.push({ inventory_item_id: item.inventory_item_id, counted_quantity: quantity, reason: reason || "" });
  }
  await apiRequest(`/businesses/${businessId}/inventory/stock-counts/${encodeURIComponent(countId)}`, { method: "PATCH", body: { status: "submitted", items: countedItems } });
  activeStockCountId = countId;
  const approve = document.getElementById("stockCountApprove");
  approve.disabled = false;
  approve.dataset.countId = countId;
  const output = document.getElementById("stockCountMessage");
  output.textContent = `${translate("inventoryCountSubmitted")}: ${countId.slice(0, 8)}`;
  output.hidden = false;
  return true;
};

document.getElementById("stockCountForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = document.getElementById("stockCountSubmit");
  button.disabled = true;
  clearMessage(document.getElementById("stockCountMessage"));
  try {
    const created = await apiRequest(`/businesses/${businessId}/inventory/stock-counts`, { method: "POST", body: { location_id: document.getElementById("stockCountLocation").value } });
    const countId = created.stock_count.id;
    const submitted = await enterStockCount(countId);
    if (!submitted) {
      await apiRequest(`/businesses/${businessId}/inventory/stock-counts/${encodeURIComponent(countId)}`, { method: "DELETE" });
      showFailure(translate("inventoryCountCancelled"));
    } else await load();
  } catch (error) { showFailure(error?.message || translate("inventoryCountError")); }
  finally { button.disabled = !hasLoadedLocations; }
});

document.getElementById("stockCountRows").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-stock-count-action]");
  if (!button) return;
  const id = button.dataset.stockCountId;
  const action = button.dataset.stockCountAction;
  button.disabled = true;
  try {
    if (action === "resume") {
      const submitted = await enterStockCount(id);
      if (!submitted) {
        button.disabled = false;
        return;
      }
    } else if (action === "delete") await apiRequest(`/businesses/${businessId}/inventory/stock-counts/${encodeURIComponent(id)}`, { method: "DELETE" });
    else await apiRequest(`/businesses/${businessId}/inventory/stock-counts/${encodeURIComponent(id)}`, { method: "PATCH", body: { status: "approved" } });
    await load();
    if (action === "approved") showSuccess(translate("inventoryCountApproved"));
  } catch (error) { showFailure(error?.message || translate(action === "approved" ? "inventoryCountApproveError" : "inventoryCountError")); button.disabled = false; }
});

document.getElementById("stockCountApprove").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  if (!activeStockCountId || button.dataset.countId !== activeStockCountId) return;
  button.disabled = true;
  try {
    await apiRequest(`/businesses/${businessId}/inventory/stock-counts/${encodeURIComponent(activeStockCountId)}`, { method: "PATCH", body: { status: "approved" } });
    activeStockCountId = null;
    delete button.dataset.countId;
    const output = document.getElementById("stockCountMessage");
    output.textContent = translate("inventoryCountApproved");
    output.hidden = false;
    await load();
  } catch (error) { showFailure(error?.message || translate("inventoryCountApproveError")); button.disabled = false; }
});

document.getElementById("addRecipeIngredient").addEventListener("click", () => {
  const itemId = document.getElementById("recipeItem").value;
  const quantity = Number(document.getElementById("recipeQuantity").value);
  const item = activeItems().find((current) => current.id === itemId);
  if (!item || !Number.isFinite(quantity) || quantity <= 0) {
    showFailure(translate("inventoryItemQuantityRequired"));
    return;
  }
  if (recipeIngredients.some((ingredient) => ingredient.id === item.id)) {
    showFailure(translate("inventoryDuplicateRecipeItem"));
    return;
  }
  const quantityUnit = document.getElementById("recipeQuantityUnit").value;
  if (recipeUnitFamily(quantityUnit) !== recipeUnitFamily(item.unit)) {
    showFailure(translate("inventoryRecipeUnitMismatch"));
    return;
  }
  recipeIngredients.push({ id: item.id, name: item.name, unit: quantityUnit, quantity });
  recipeDirty = true;
  renderRecipeIngredients();
  document.getElementById("recipeQuantity").value = "";
  showSuccess(translate("inventoryRecipeIngredientDraftAdded"));
});

recipeIngredientsList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-recipe-item]");
  if (!button) return;
  recipeIngredients = recipeIngredients.filter((ingredient) => ingredient.id !== button.dataset.removeRecipeItem);
  recipeDirty = true;
  renderRecipeIngredients();
});

document.getElementById("recipeForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = document.getElementById("recipeSubmit");
  const productId = document.getElementById("recipeProduct").value;
  if (!productId || !recipeIngredients.length || !recipeLoaded || productId !== loadedRecipeProductId) {
    showFailure(translate("inventoryRecipeIncomplete"));
    return;
  }
  button.disabled = true;
  try {
    const savedRecipe = await apiRequest(`/businesses/${businessId}/products/${encodeURIComponent(productId)}/recipe`, {
      method: "PUT",
      body: {
        expected_revision: recipeRevision,
        ingredients: recipeIngredients.map((ingredient) => ({
          inventory_item_id: ingredient.id,
          quantity: ingredient.quantity,
          unit: ingredient.unit,
        })),
      },
    });
    recipeRevision = savedRecipe.revision;
    recipeDirty = false;
    recipeIngredients = savedRecipe.ingredients.map((entry) => {
      const item = items.find((current) => current.id === entry.inventory_item_id);
      return { id: entry.inventory_item_id, name: item?.name || "", unit: entry.unit, quantity: Number(entry.quantity) };
    });
    if (document.getElementById("productionProduct").value === productId) {
      productionRecipeProductId = productId;
      productionRecipeStatus = recipeIngredients.length ? "available" : "missing";
      updateProductionAvailability();
    }
    renderRecipeIngredients();
    showSuccess(translate("inventoryRecipeSaved"));
  } catch (error) {
    showFailure(translate(error?.apiMessage?.startsWith("Recipe changed since it was loaded") ? "inventoryRecipeStale" : "inventoryRecipeSaveError"));
  } finally {
    updateRecipeSubmitState();
  }
});

const initializeInventory = async () => {
  hideLoadError();
  setLoading(true);
  retryButton.disabled = true;
  try {
    if (!appShellReady) {
      await initAppShell({ activeNav: "inventory" });
      appShellReady = true;
    }
    await load();
  } catch {
    showLoadError();
  } finally {
    retryButton.disabled = false;
    if (!loading) setLoading(false);
  }
};

void initializeInventory();
