import { getSession } from "../../../shared/data/storage.js";
import { apiRequest } from "../../../shared/api/client.js";
import { initAppShell } from "../../../shared/ui/ui.js";
import { applyTranslations, getLanguage, setLanguage, translate } from "../../../shared/i18n/i18n.js";

const session = getSession();
const businessId = session?.businessId;
const rows = document.getElementById("inventoryRows");
const message = document.getElementById("inventoryMessage");
let items = [];
let products = [];
const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
const formatNumber = (value) => Number(value || 0).toLocaleString("pt-BR", { maximumFractionDigits: 3 });

const load = async () => {
  const [data, productData, supplierData] = await Promise.all([apiRequest(`/businesses/${businessId}/inventory/items`), apiRequest(`/businesses/${businessId}/products`), apiRequest(`/businesses/${businessId}/suppliers`)]);
  items = data.items;
  products = productData.products || [];
  const itemOptions = items.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)} (${escapeHtml(item.unit)})</option>`).join("");
  document.getElementById("movementItem").innerHTML = itemOptions;
  document.getElementById("purchaseItem").innerHTML = itemOptions;
  const supplierSelect = document.getElementById("purchaseSupplier");
  supplierSelect.innerHTML = `<option value="">No supplier</option>${(supplierData.suppliers || []).map((supplier) => `<option value="${escapeHtml(supplier.id)}">${escapeHtml(supplier.name)}</option>`).join("")}`;
  document.getElementById("recipeItem").innerHTML = itemOptions;
  document.getElementById("recipeProduct").innerHTML = products.map((product) => `<option value="${escapeHtml(product.id)}">${escapeHtml(product.name)}</option>`).join("");
  rows.innerHTML = items.length ? items.map((item) => {
    const low = Number(item.current_quantity) <= Number(item.minimum_quantity);
    return `<tr><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.unit)}</td><td>${formatNumber(item.current_quantity)}</td><td>${formatNumber(item.minimum_quantity)}</td><td class="${low ? "inventory-warning" : ""}">${low ? translate("belowMinimum") : translate("normal")}</td></tr>`;
  }).join("") : `<tr><td colspan="5">${translate("noItems")}</td></tr>`;
};

document.getElementById("inventoryForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  message.textContent = "";
  try {
    await apiRequest(`/businesses/${businessId}/inventory/items`, { method: "POST", body: { name: document.getElementById("itemName").value.trim(), unit: document.getElementById("itemUnit").value, current_quantity: Number(document.getElementById("itemQuantity").value), minimum_quantity: Number(document.getElementById("itemMinimum").value) } });
    event.target.reset();
    message.textContent = translate("itemRegistered");
    await load();
  } catch (error) { message.textContent = error.message; }
});

document.getElementById("movementForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const output = document.getElementById("movementMessage");
  try { await apiRequest(`/businesses/${businessId}/inventory/items/${document.getElementById("movementItem").value}/movements`, { method: "POST", body: { type: document.getElementById("movementType").value, quantity: Number(document.getElementById("movementQuantity").value), description: document.getElementById("movementDescription").value.trim() } }); output.textContent = "Movement saved."; event.target.reset(); await load(); } catch (error) { output.textContent = error.message; }
});

document.getElementById("purchaseForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const output = document.getElementById("purchaseMessage");
  try {
    await apiRequest(`/businesses/${businessId}/purchases`, { method: "POST", body: { supplier_id: document.getElementById("purchaseSupplier").value || null, items: [{ inventory_item_id: document.getElementById("purchaseItem").value, quantity: Number(document.getElementById("purchaseQuantity").value), unit_cost: Number(document.getElementById("purchaseUnitCost").value) }] } });
    output.textContent = "Purchase received.";
    event.target.reset();
    await load();
  } catch (error) { output.textContent = error.message; }
});

document.getElementById("recipeForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const output = document.getElementById("recipeMessage");
  try { await apiRequest(`/businesses/${businessId}/products/${document.getElementById("recipeProduct").value}/recipe`, { method: "PUT", body: { ingredients: [{ inventory_item_id: document.getElementById("recipeItem").value, quantity: Number(document.getElementById("recipeQuantity").value) }] } }); output.textContent = "Recipe saved."; } catch (error) { output.textContent = error.message; }
});

(async () => {
  await initAppShell({ activeNav: "inventory" });
  const languageSelect = document.getElementById("languageSelect");
  languageSelect.value = getLanguage();
  languageSelect.addEventListener("change", () => { setLanguage(languageSelect.value); applyTranslations(); load(); });
  applyTranslations();
  await load();
})();
