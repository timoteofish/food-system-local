import { getSession } from "../../../shared/data/storage.js";
import { apiRequest } from "../../../shared/api/client.js";
import { initAppShell } from "../../../shared/ui/ui.js";
import { getLanguage, getLocale, translate } from "../../../shared/i18n/i18n.js";
import { formatInventoryUnit } from "../../../shared/utils/utils.js";

const session = getSession();
const businessId = session?.businessId;
const rows = document.getElementById("inventoryRows");
const count = document.getElementById("inventoryCount");
const loadMessage = document.getElementById("inventoryLoadMessage");
const loadRetry = document.getElementById("inventoryLoadRetry");
const movementType = document.getElementById("movementType");
const movementDirectionField = document.getElementById("movementDirectionField");
const recipeIngredientsList = document.getElementById("recipeIngredients");
let items = [];
let products = [];
let suppliers = [];
let recipeIngredients = [];
let hasLoadedInventory = false;
let hasLoadedProducts = false;
let hasLoadedSuppliers = false;
let loading = false;
let appShellReady = false;

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

const clearMessage = (element) => {
  if (!element) return;
  element.textContent = "";
  element.hidden = true;
  element.removeAttribute("data-state");
};

const optionsForItems = () => items.map((item) =>
  `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)} (${escapeHtml(formatInventoryUnit(item.unit))})</option>`
).join("");

const renderSelectOptions = () => {
  const itemOptions = optionsForItems();
  const itemPlaceholder = !hasLoadedInventory
    ? translate("inventoryItemsUnavailable")
    : items.length ? translate("inventorySelectItem") : translate("inventoryRegisterItemsFirst");
  const productPlaceholder = !hasLoadedProducts
    ? translate("inventoryProductsUnavailable")
    : products.length ? translate("inventorySelectProduct") : translate("inventoryNoProducts");
  const supplierOptions = suppliers.map((supplier) =>
    `<option value="${escapeHtml(supplier.id)}">${escapeHtml(supplier.name)}</option>`
  ).join("");

  ["movementItem", "purchaseItem", "recipeItem"].forEach((id) => {
    const select = document.getElementById(id);
    const previousValue = select.value;
    select.innerHTML = `<option value="">${itemPlaceholder}</option>${itemOptions}`;
    if (items.some((item) => item.id === previousValue)) select.value = previousValue;
    select.disabled = !hasLoadedInventory || items.length === 0;
  });

  const supplierSelect = document.getElementById("purchaseSupplier");
  const previousSupplier = supplierSelect.value;
  const noSupplier = hasLoadedSuppliers
    ? translate("Sem fornecedor")
    : translate("inventorySuppliersUnavailable");
  supplierSelect.innerHTML = `<option value="">${noSupplier}</option>${supplierOptions}`;
  if (suppliers.some((supplier) => supplier.id === previousSupplier)) supplierSelect.value = previousSupplier;
  supplierSelect.disabled = !hasLoadedSuppliers;

  const productSelect = document.getElementById("recipeProduct");
  const previousProduct = productSelect.value;
  productSelect.innerHTML = `<option value="">${productPlaceholder}</option>${products.map((product) =>
    `<option value="${escapeHtml(product.id)}">${escapeHtml(product.name)}</option>`
  ).join("")}`;
  if (products.some((product) => product.id === previousProduct)) productSelect.value = previousProduct;
  productSelect.disabled = !hasLoadedProducts || products.length === 0;

  document.getElementById("movementSubmit").disabled = !hasLoadedInventory || items.length === 0;
  document.getElementById("purchaseSubmit").disabled = !hasLoadedInventory || items.length === 0;
  document.getElementById("recipeSubmit").disabled = !hasLoadedInventory || !hasLoadedProducts || items.length === 0 || products.length === 0;
  document.getElementById("addRecipeIngredient").disabled = !hasLoadedInventory || items.length === 0;
};

const renderRecipeIngredients = () => {
  recipeIngredientsList.innerHTML = recipeIngredients.map((ingredient) => `
    <li>
      <span>${escapeHtml(ingredient.name)} · ${formatNumber(ingredient.quantity)} ${escapeHtml(formatInventoryUnit(ingredient.unit))}</span>
      <button class="btn btn--secondary" type="button" data-remove-recipe-item="${escapeHtml(ingredient.id)}" aria-label="${escapeHtml(translate("removeRecipeIngredient").replace("$1", ingredient.name))}">${translate("Remover")}</button>
    </li>
  `).join("");
};

const renderInventory = () => {
  if (!hasLoadedInventory) return;
  rows.setAttribute("aria-busy", "false");
  const itemWord = items.length === 1
    ? translate("insumo")
    : translate(getLanguage() === "en" ? "ingredients" : "insumos");
  count.textContent = `${formatNumber(items.length)} ${itemWord}`;
  if (!items.length) {
    rows.innerHTML = `<tr><td class="inventory-empty" colspan="5">${translate("noItems")}</td></tr>`;
    return;
  }

  rows.innerHTML = items.map((item) => {
    const current = Number(item.current_quantity || 0);
    const minimum = Number(item.minimum_quantity || 0);
    const isBelowMinimum = current < minimum;
    const isAtMinimum = minimum > 0 && current === minimum;
    const status = isBelowMinimum
      ? translate("belowMinimum")
      : isAtMinimum ? translate("atMinimum") : translate("normal");
    const statusClass = isBelowMinimum ? "is-low" : isAtMinimum ? "is-at-minimum" : "";
    return `
      <tr>
        <td><strong>${escapeHtml(item.name)}</strong></td>
        <td>${escapeHtml(formatInventoryUnit(item.unit))}</td>
        <td>${formatNumber(current)}</td>
        <td>${formatNumber(minimum)}</td>
        <td><span class="inventory-table__status ${statusClass}">${escapeHtml(status)}</span></td>
      </tr>
    `;
  }).join("");
};

const load = async () => {
  if (loading) return false;
  loading = true;
  loadRetry.hidden = true;
  loadRetry.disabled = true;
  clearMessage(loadMessage);
  if (!hasLoadedInventory) {
    count.textContent = "—";
    rows.setAttribute("aria-busy", "true");
    rows.innerHTML = `<tr><td class="inventory-empty" colspan="5" role="status">${translate("inventoryLoadingItems")}</td></tr>`;
  }
  try {
    const results = await Promise.allSettled([
      apiRequest(`/businesses/${businessId}/inventory/items`),
      apiRequest(`/businesses/${businessId}/products`),
      apiRequest(`/businesses/${businessId}/suppliers`),
    ]);
    const [inventoryResult, productResult, supplierResult] = results;
    let hasLoadError = false;

    if (inventoryResult.status === "fulfilled") {
      items = Array.isArray(inventoryResult.value.items) ? inventoryResult.value.items : [];
      hasLoadedInventory = true;
      renderInventory();
    } else {
      hasLoadError = true;
      if (!hasLoadedInventory) {
        count.textContent = translate("inventoryUnavailable");
        rows.setAttribute("aria-busy", "false");
        rows.innerHTML = `<tr><td class="inventory-empty" colspan="5">${translate("inventoryNotAvailable")}</td></tr>`;
      }
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

    renderSelectOptions();
    if (hasLoadError) {
      setMessage(loadMessage, translate("inventoryLoadError"));
      loadRetry.hidden = false;
      return false;
    }
    return true;
  } catch {
    setMessage(loadMessage, translate("inventoryLoadError"));
    loadRetry.hidden = false;
    if (!hasLoadedInventory) {
      count.textContent = translate("inventoryUnavailable");
      rows.setAttribute("aria-busy", "false");
      rows.innerHTML = `<tr><td class="inventory-empty" colspan="5">${translate("inventoryNotAvailable")}</td></tr>`;
    }
    return false;
  } finally {
    loading = false;
    loadRetry.disabled = false;
  }
};

loadRetry.addEventListener("click", () => void initializeInventory());

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
        current_quantity: Number(document.getElementById("itemQuantity").value),
        minimum_quantity: Number(document.getElementById("itemMinimum").value),
      },
    });
    form.reset();
    await load();
    setMessage(output, translate("inventoryItemSaved"), "success");
  } catch {
    setMessage(output, translate("inventoryItemSaveError"));
  } finally {
    button.disabled = false;
  }
});

document.getElementById("movementForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = document.getElementById("movementSubmit");
  const output = document.getElementById("movementMessage");
  const type = movementType.value;
  button.disabled = true;
  clearMessage(output);
  try {
    await apiRequest(`/businesses/${businessId}/inventory/items/${encodeURIComponent(document.getElementById("movementItem").value)}/movements`, {
      method: "POST",
      body: {
        type,
        direction: type === "adjustment" ? Number(document.getElementById("movementDirection").value) : 1,
        quantity: Number(document.getElementById("movementQuantity").value),
        description: document.getElementById("movementDescription").value.trim(),
      },
    });
    form.reset();
    movementDirectionField.hidden = movementType.value !== "adjustment";
    await load();
    setMessage(output, translate("inventoryMovementSaved"), "success");
  } catch {
    setMessage(output, translate("inventoryMovementSaveError"));
  } finally {
    button.disabled = items.length === 0;
  }
});

document.getElementById("purchaseForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = document.getElementById("purchaseSubmit");
  const output = document.getElementById("purchaseMessage");
  button.disabled = true;
  clearMessage(output);
  try {
    await apiRequest(`/businesses/${businessId}/purchases`, {
      method: "POST",
      body: {
        supplier_id: document.getElementById("purchaseSupplier").value || null,
        items: [{
          inventory_item_id: document.getElementById("purchaseItem").value,
          quantity: Number(document.getElementById("purchaseQuantity").value),
          unit_cost: Number(document.getElementById("purchaseUnitCost").value),
        }],
      },
    });
    form.reset();
    await load();
    setMessage(output, translate("inventoryPurchaseSaved"), "success");
  } catch {
    setMessage(output, translate("inventoryPurchaseSaveError"));
  } finally {
    button.disabled = items.length === 0;
  }
});

document.getElementById("addRecipeIngredient").addEventListener("click", () => {
  const output = document.getElementById("recipeMessage");
  const itemId = document.getElementById("recipeItem").value;
  const quantity = Number(document.getElementById("recipeQuantity").value);
  const item = items.find((current) => current.id === itemId);
  if (!item || !Number.isFinite(quantity) || quantity <= 0) {
    setMessage(output, translate("inventoryItemQuantityRequired"));
    return;
  }
  if (recipeIngredients.some((ingredient) => ingredient.id === item.id)) {
    setMessage(output, translate("inventoryDuplicateRecipeItem"));
    return;
  }
  recipeIngredients.push({ id: item.id, name: item.name, unit: item.unit, quantity });
  renderRecipeIngredients();
  clearMessage(output);
  document.getElementById("recipeQuantity").value = "";
});

recipeIngredientsList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-recipe-item]");
  if (!button) return;
  recipeIngredients = recipeIngredients.filter((ingredient) => ingredient.id !== button.dataset.removeRecipeItem);
  renderRecipeIngredients();
});

document.getElementById("recipeForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = document.getElementById("recipeSubmit");
  const output = document.getElementById("recipeMessage");
  const productId = document.getElementById("recipeProduct").value;
  if (!productId || !recipeIngredients.length) {
    setMessage(output, translate("inventoryRecipeIncomplete"));
    return;
  }
  button.disabled = true;
  clearMessage(output);
  try {
    await apiRequest(`/businesses/${businessId}/products/${encodeURIComponent(productId)}/recipe`, {
      method: "PUT",
      body: {
        ingredients: recipeIngredients.map((ingredient) => ({
          inventory_item_id: ingredient.id,
          quantity: ingredient.quantity,
        })),
      },
    });
    recipeIngredients = [];
    renderRecipeIngredients();
    form.reset();
    setMessage(output, translate("inventoryRecipeSaved"), "success");
  } catch {
    setMessage(output, translate("inventoryRecipeSaveError"));
  } finally {
    button.disabled = items.length === 0 || products.length === 0;
  }
});

const initializeInventory = async () => {
  loadRetry.hidden = true;
  loadRetry.disabled = true;
  clearMessage(loadMessage);
  try {
    if (!appShellReady) {
      await initAppShell({ activeNav: "inventory" });
      appShellReady = true;
    }
    await load();
  } catch {
    setMessage(loadMessage, translate("Não foi possível abrir o estoque"));
    loadRetry.hidden = false;
  } finally {
    loadRetry.disabled = false;
  }
};

void initializeInventory();
