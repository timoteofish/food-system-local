import {
  addCategoryRemote,
  loadCategories,
  loadProducts,
  saveProduct,
  toggleProductStatus,
} from "../../../shared/features/products/index.js";
import { escapeHtml, formatPrice, generateId, parsePrice, safeImageUrl } from "../../../shared/utils/utils.js";
import { initAppShell } from "../../../shared/ui/ui.js";
import { initCategoryUserPanel } from "./category-user/index.js";
import { initImageUserPanel } from "./image-user/index.js";
import { initProductDetailsPanel } from "./id-product/index.js";

let products = [];

const list = document.getElementById("productList");
const mobileList = document.getElementById("mobileProductList");
const form = document.getElementById("productForm");
const imageInput = document.getElementById("productImage");
const previewImg = document.getElementById("previewImg");
const imagePickerTitle = document.getElementById("imagePickerTitle");
const openImageUserPanelButton = document.getElementById("openImageUserPanel");
const priceInput = document.getElementById("productPrice");
const searchInput = document.getElementById("productSearch");
const categorySelect = document.getElementById("productCategory");
const productCategoryButton = document.getElementById("productCategoryButton");
const categoryDropdown = document.getElementById("categoryDropdown");
const categoryList = document.getElementById("categoryList");

let searchQuery = "";
let productImage = "";
let imageActions = null;

const ensureImageActions = () => {
  if (imageActions) return imageActions;
  const actions = document.createElement("div");
  actions.className = "image-actions image-actions--overlay";
  actions.innerHTML = `
    <button type="button" class="image-actions__item" data-image-action="edit">Editar imagem</button>
    <button type="button" class="image-actions__item" data-image-action="replace">Trocar foto</button>
    <button type="button" class="image-actions__item image-actions__item--danger" data-image-action="remove">Remover foto</button>
  `;
  openImageUserPanelButton?.append(actions);
  imageActions = actions;
  return actions;
};

const syncCategorySelect = () => {
  const categories = categoryNames;
  categorySelect.innerHTML = categories.map((item) => `<option>${escapeHtml(item)}</option>`).join("");
  if (!categories.includes(categorySelect.value)) {
    categorySelect.value = categories[0] || "Hamburgueres";
  }
  if (productCategoryButton) {
    productCategoryButton.textContent = `${categorySelect.value} ▾`;
  }
};

const buildCategoryList = () => {
  if (!categoryList) return;
  categoryList.innerHTML = categoryNames
    .map(
      (category) =>
        `<button type="button" class="category-item ${category === categorySelect.value ? "category-item--active" : ""}" data-value="${escapeHtml(category)}">${escapeHtml(category)}</button>`
    )
    .join("");
};

const closeDropdown = () => {
  if (categoryDropdown) categoryDropdown.hidden = true;
};

const openDropdown = () => {
  buildCategoryList();
  if (categoryDropdown) categoryDropdown.hidden = false;
};

const categoryUserPanel = initCategoryUserPanel({
  onCreate: async (value) => {
    categoryNames = await addCategoryRemote(value);
    syncCategorySelect();
    categorySelect.value = value;
    if (productCategoryButton) {
      productCategoryButton.textContent = `${value} ▾`;
    }
    buildCategoryList();
  },
});

const imageUserPanel = initImageUserPanel({
  onApply: async (result) => {
    productImage = result;
    if (previewImg) {
      previewImg.src = result;
      previewImg.hidden = !result;
    }
    if (imagePickerTitle) {
      imagePickerTitle.textContent = result ? "Foto pronta" : "Adicionar imagem";
      imagePickerTitle.hidden = Boolean(result);
    }
    if (!result && imageActions) {
      imageActions.remove();
      imageActions = null;
    }
  },
});

const clearProductImage = () => {
  productImage = "";
  if (imageInput) imageInput.value = "";
  if (previewImg) {
    previewImg.src = "";
    previewImg.hidden = true;
  }
  if (imagePickerTitle) {
    imagePickerTitle.textContent = "Adicionar imagem";
    imagePickerTitle.hidden = false;
  }
  if (imageActions) {
    imageActions.remove();
    imageActions = null;
  }
};

if (priceInput) {
  priceInput.addEventListener("input", (event) => {
    event.target.value = event.target.value.replace(/[^0-9.,]/g, "");
  });
  priceInput.addEventListener("blur", (event) => {
    event.target.value = formatPrice(parsePrice(event.target.value), { prefix: false });
  });
}

const renderImage = (item) => {
  const image = safeImageUrl(item.image);
  if (image) {
    return `<img class="product-thumb" src="${escapeHtml(image)}" alt="${escapeHtml(item.name)}" />`;
  }
  return `<div class="product-thumb product-thumb--empty">${escapeHtml(String(item.name || "P").slice(0, 2).toUpperCase())}</div>`;
};

const updateProductStatus = async (id) => {
  const index = products.findIndex((item) => item.id === id);
  if (index === -1) return null;

  try {
    products[index] = await toggleProductStatus(products[index]);
  } catch {
    products[index] = { ...products[index], active: !products[index].active };
  }

  return products[index];
};

const render = () => {
  const query = searchQuery.trim().toLowerCase();
  const visible = query
    ? products.filter(
        (item) =>
      item.name?.toLowerCase().includes(query) ||
      item.description?.toLowerCase().includes(query) ||
      item.category?.toLowerCase().includes(query) ||
      item.id?.toLowerCase().includes(query)
      )
    : products;

  list.innerHTML = visible
    .map(
      (item) => `
      <tr data-id="${escapeHtml(item.id)}">
        <td>${renderImage(item)}</td>
        <td><strong>${escapeHtml(item.name)}</strong><br><span>${escapeHtml(item.description || "")}</span></td>
        <td>${escapeHtml(item.id || "")}</td>
        <td>${escapeHtml(item.category)}</td>
        <td>${escapeHtml(formatPrice(item.price))}</td>
        <td>
          <button class="status-btn ${item.active ? "status-btn--active" : "status-btn--inactive"}" data-id="${escapeHtml(item.id)}" aria-pressed="${item.active}">${item.active ? "Ativo" : "Inativo"}</button>
        </td>
      </tr>
    `
    )
    .join("");

  if (mobileList) {
    mobileList.innerHTML = visible.length
      ? visible
          .map(
            (item) => `
              <button class="mobile-product-list__item" type="button" data-product-detail="${escapeHtml(item.id)}">
                <span>${escapeHtml(item.name || "Produto sem nome")}</span>
                <b class="mobile-product-list__arrow" aria-hidden="true">›</b>
              </button>
            `
          )
          .join("")
      : '<p class="mobile-product-list__empty">Nenhum produto encontrado</p>';
  }
};

const productDetailsPanel = initProductDetailsPanel({
  onToggleStatus: async (id) => {
    const updated = await updateProductStatus(id);
    render();
    return updated;
  },
});

list.addEventListener("click", async (event) => {
  const button = event.target.closest(".status-btn");
  if (!button) return;

  await updateProductStatus(button.dataset.id);
  render();
});

mobileList?.addEventListener("click", (event) => {
  const item = event.target.closest("[data-product-detail]");
  if (!item) return;
  const product = products.find((current) => current.id === item.dataset.productDetail);
  if (product) productDetailsPanel.open(product);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    const saved = await saveProduct({
      id: generateId("prod"),
      name: document.getElementById("productName").value.trim() || "Novo produto",
      category: categorySelect.value,
      price: formatPrice(parsePrice(priceInput.value), { prefix: false }),
      description: document.getElementById("productDescription").value.trim(),
      image: productImage,
      active: true,
    });
    products.unshift(saved);
  } catch (error) {
    alert(error.message || "Não foi possível salvar o produto.");
    return;
  }
  form.reset();
  clearProductImage();
  syncCategorySelect();
  render();
});

openImageUserPanelButton?.addEventListener("click", () => {
  if (productImage) {
    const actions = ensureImageActions();
    actions.hidden = false;
    return;
  }
  imageUserPanel.open(productImage || "");
});

openImageUserPanelButton?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  openImageUserPanelButton.click();
});

document.addEventListener("click", (event) => {
  const insideImageArea =
    openImageUserPanelButton?.contains(event.target) || imageActions?.contains(event.target);
  if (!insideImageArea && imageActions) {
    imageActions.remove();
    imageActions = null;
  }
});

openImageUserPanelButton?.addEventListener("click", (event) => {
  const action = event.target.closest("[data-image-action]")?.dataset.imageAction;
  if (action && imageActions) {
    event.stopPropagation();
    imageActions.remove();
    imageActions = null;
  }
  if (action === "edit") {
    imageUserPanel.open(productImage || "");
  } else if (action === "replace") {
    clearProductImage();
    imageUserPanel.open("");
  } else if (action === "remove") {
    clearProductImage();
    return;
  } else if (productImage) {
    const actions = ensureImageActions();
    actions.hidden = false;
  }
});

productCategoryButton?.addEventListener("click", (event) => {
  event.stopPropagation();
  if (categoryDropdown?.hidden) openDropdown();
  else closeDropdown();
});

categoryList?.addEventListener("click", (event) => {
  const button = event.target.closest(".category-item");
  if (!button) return;
  categorySelect.value = button.dataset.value;
  productCategoryButton.textContent = `${button.dataset.value} ▾`;
  buildCategoryList();
  closeDropdown();
});

document.getElementById("addCategory")?.addEventListener("click", async () => {
  closeDropdown();
  categoryUserPanel.open();
});

document.addEventListener("click", (event) => {
  if (categoryDropdown && productCategoryButton && !categoryDropdown.contains(event.target) && !productCategoryButton.contains(event.target)) {
    closeDropdown();
  }
});

searchInput?.addEventListener("input", (event) => {
  searchQuery = event.target.value || "";
  render();
});

let categoryNames = [];

(async () => {
  await initAppShell({ activeNav: "products" });
  products = await loadProducts();
  categoryNames = await loadCategories();
  syncCategorySelect();
  buildCategoryList();
  render();
})();
