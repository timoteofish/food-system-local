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
import { translate } from "../../../shared/i18n/i18n.js";

let products = [];
let productsLoadFailed = false;

const list = document.getElementById("productList");
const mobileList = document.getElementById("mobileProductList");
const form = document.getElementById("productForm");
const imageInput = document.getElementById("productImage");
const previewImg = document.getElementById("previewImg");
const imagePickerTitle = document.getElementById("imagePickerTitle");
const openImageUserPanelButton = document.getElementById("openImageUserPanel");
const imagePreview = document.getElementById("imagePreview");
const priceInput = document.getElementById("productPrice");
const searchInput = document.getElementById("productSearch");
const categorySelect = document.getElementById("productCategory");
const productCategoryButton = document.getElementById("productCategoryButton");
const categoryDropdown = document.getElementById("categoryDropdown");
const categoryList = document.getElementById("categoryList");
const productFeedback = document.getElementById("productFeedback");
const productCount = document.getElementById("productCount");
const productsRetry = document.getElementById("productsRetry");

let searchQuery = "";
let productImage = "";
let imageActions = null;

const ensureImageActions = () => {
  if (imageActions) return imageActions;
  const actions = document.createElement("div");
  actions.className = "image-actions image-actions--overlay";
  actions.innerHTML = `
    <button type="button" class="image-actions__item" data-image-action="edit">${translate("Editar imagem")}</button>
    <button type="button" class="image-actions__item" data-image-action="replace">${translate("Trocar foto")}</button>
    <button type="button" class="image-actions__item image-actions__item--danger" data-image-action="remove">${translate("Remover foto")}</button>
  `;
  imagePreview?.append(actions);
  imageActions = actions;
  return actions;
};

const syncCategorySelect = () => {
  categorySelect.innerHTML = categoryNames.length
    ? categoryNames.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join("")
    : `<option value="">${translate("Selecione uma categoria")}</option>`;
  if (!categoryNames.includes(categorySelect.value)) categorySelect.value = categoryNames[0] || "";
  if (productCategoryButton) {
    productCategoryButton.textContent = categorySelect.value || translate("Escolher categoria");
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
  productCategoryButton?.setAttribute("aria-expanded", "false");
};

const openDropdown = () => {
  buildCategoryList();
  if (categoryDropdown) categoryDropdown.hidden = false;
  productCategoryButton?.setAttribute("aria-expanded", "true");
};

const showProductFeedback = (message, state = "error") => {
  if (!productFeedback) return;
  productFeedback.textContent = message;
  productFeedback.dataset.state = state;
  productFeedback.hidden = false;
};

const clearProductFeedback = () => {
  if (!productFeedback) return;
  productFeedback.hidden = true;
  productFeedback.textContent = "";
  productFeedback.removeAttribute("data-state");
};

const categoryUserPanel = initCategoryUserPanel({
  onCreate: async (value) => {
    categoryNames = await addCategoryRemote(value);
    syncCategorySelect();
    categorySelect.value = value;
    if (productCategoryButton) {
      productCategoryButton.textContent = value;
    }
    buildCategoryList();
    clearProductFeedback();
    productsRetry.hidden = true;
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
      imagePickerTitle.textContent = translate(result ? "Foto pronta" : "Adicionar imagem");
      imagePickerTitle.hidden = Boolean(result);
    }
    openImageUserPanelButton?.setAttribute(
      "aria-label",
      translate(result ? "Editar imagem do produto" : "Adicionar imagem ao produto")
    );
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
    imagePickerTitle.textContent = translate("Adicionar imagem");
    imagePickerTitle.hidden = false;
  }
  openImageUserPanelButton?.setAttribute("aria-label", translate("Adicionar imagem ao produto"));
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
  products[index] = await toggleProductStatus(products[index]);
  return products[index];
};

const render = () => {
  const query = searchQuery.trim().toLowerCase();
  const visible = query
    ? products.filter(
        (item) =>
          String(item.name || "").toLowerCase().includes(query) ||
          String(item.description || "").toLowerCase().includes(query) ||
          String(item.category || "").toLowerCase().includes(query) ||
          String(item.id || "").toLowerCase().includes(query)
      )
    : products;

  if (productCount) {
    const total = products.length;
    if (productsLoadFailed) {
      productCount.textContent = translate("Lista indisponível");
    } else if (query) {
      productCount.textContent = translate("$1 de $2 produtos encontrados")
        .replace("$1", String(visible.length))
        .replace("$2", String(total));
    } else {
      productCount.textContent = `${total} ${translate(total === 1 ? "produto" : "produtos")}`;
    }
  }

  const productRows = visible.map((item) => {
    const productName = escapeHtml(item.name || translate("Produto sem nome"));
    const statusLabel = translate(item.active ? "Ativo" : "Inativo");
    const statusAction = translate(item.active ? "Desativar produto" : "Ativar produto");
    return `
      <tr data-id="${escapeHtml(item.id)}">
        <td>${renderImage(item)}</td>
        <td><strong>${productName}</strong><br /><span>${escapeHtml(item.description || "")}</span></td>
        <td>${escapeHtml(item.id || "")}</td>
        <td>${escapeHtml(item.category || "")}</td>
        <td>${escapeHtml(formatPrice(item.price))}</td>
        <td>
          <button
            class="status-btn ${item.active ? "status-btn--active" : "status-btn--inactive"}"
            type="button"
            data-id="${escapeHtml(item.id)}"
            aria-pressed="${item.active}"
            aria-label="${statusAction}: ${productName}"
          >${statusLabel}</button>
        </td>
      </tr>
    `;
  }).join("");

  if (productsLoadFailed) {
    list.setAttribute("aria-busy", "false");
    list.innerHTML = `<tr><td class="products-table-empty" colspan="6">${translate("A lista de produtos está indisponível.")}</td></tr>`;
  } else if (visible.length) {
    list.setAttribute("aria-busy", "false");
    list.innerHTML = productRows;
  } else {
    list.setAttribute("aria-busy", "false");
    const message = translate(query ? "Nenhum produto corresponde à busca" : "Nenhum produto cadastrado");
    list.innerHTML = `<tr><td class="products-table-empty" colspan="6">${message}</td></tr>`;
  }

  if (mobileList) {
    if (productsLoadFailed) {
      mobileList.innerHTML = `<p class="mobile-product-list__empty">${translate("A lista de produtos está indisponível.")}</p>`;
    } else if (visible.length) {
      mobileList.innerHTML = visible.map((item) => `
        <button class="mobile-product-list__item" type="button" data-product-detail="${escapeHtml(item.id)}">
          <span>${escapeHtml(item.name || translate("Produto sem nome"))}</span>
          <b class="mobile-product-list__arrow" aria-hidden="true">›</b>
        </button>
      `).join("");
    } else {
      mobileList.innerHTML = `<p class="mobile-product-list__empty">${translate(query ? "Nenhum produto corresponde à busca" : "Nenhum produto cadastrado")}</p>`;
    }
  }
};

const productDetailsPanel = initProductDetailsPanel({
  onToggleStatus: async (id) => {
    try {
      const updated = await updateProductStatus(id);
      clearProductFeedback();
      render();
      return updated;
    } catch {
      showProductFeedback(translate("Não foi possível atualizar o status Tente novamente"));
      return null;
    }
  },
});

list.addEventListener("click", async (event) => {
  const button = event.target.closest(".status-btn");
  if (!button) return;
  button.disabled = true;
  try {
    await updateProductStatus(button.dataset.id);
    clearProductFeedback();
    render();
  } catch {
    button.disabled = false;
    showProductFeedback(translate("Não foi possível atualizar o status Tente novamente"));
  }
});

mobileList?.addEventListener("click", (event) => {
  const item = event.target.closest("[data-product-detail]");
  if (!item) return;
  const product = products.find((current) => current.id === item.dataset.productDetail);
  if (product) productDetailsPanel.open(product);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = document.getElementById("productName").value.trim();
  if (!name) {
    document.getElementById("productName").focus();
    showProductFeedback(translate("Informe o nome do produto"));
    return;
  }
  if (!categorySelect.value) {
    showProductFeedback(translate("Escolha uma categoria ou adicione uma nova"));
    productCategoryButton.focus();
    return;
  }
  const submitButton = form.querySelector('[type="submit"]');
  submitButton.disabled = true;

  try {
    const saved = await saveProduct({
      id: generateId("prod"),
      name,
      category: categorySelect.value,
      price: formatPrice(parsePrice(priceInput.value), { prefix: false }),
      description: document.getElementById("productDescription").value.trim(),
      image: productImage,
      active: true,
    });
    products.unshift(saved);
    showProductFeedback(translate("Produto adicionado"), "success");
  } catch {
    showProductFeedback(translate("Não foi possível adicionar o produto Verifique a conexão e tente novamente"));
    return;
  } finally {
    submitButton.disabled = false;
  }
  form.reset();
  clearProductImage();
  syncCategorySelect();
  render();
});

openImageUserPanelButton?.addEventListener("click", () => {
  if (productImage) {
    const actions = ensureImageActions();
    actions.hidden = !actions.hidden;
    return;
  }
  imageUserPanel.open(productImage || "");
});

document.addEventListener("click", (event) => {
  const insideImageArea = imagePreview?.contains(event.target);
  if (!insideImageArea && imageActions) {
    imageActions.remove();
    imageActions = null;
  }
});

imagePreview?.addEventListener("click", (event) => {
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
  productCategoryButton.textContent = button.dataset.value;
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
let appShellReady = false;
let productsLoading = false;

productsRetry?.addEventListener("click", () => void initializeProducts());

const initializeProducts = async () => {
  if (productsLoading) return;
  productsLoading = true;
  productsRetry.hidden = true;
  productsRetry.disabled = true;
  searchInput.disabled = true;
  const submitButton = form.querySelector('[type="submit"]');
  submitButton.disabled = true;
  clearProductFeedback();
  list.setAttribute("aria-busy", "true");
  if (!products.length) {
    list.innerHTML = `<tr><td class="products-table-empty" colspan="6" role="status">${translate("Carregando produtos")}</td></tr>`;
    mobileList.innerHTML = `<p class="mobile-product-list__empty" role="status">${translate("Carregando produtos")}</p>`;
  }
  let appShellFailed = false;
  try {
    if (!appShellReady) {
      try {
        await initAppShell({ activeNav: "products" });
      } catch (error) {
        appShellFailed = true;
        throw error;
      }
      appShellReady = true;
    }
    products = await loadProducts();
    productsLoadFailed = false;
  } catch {
    products = [];
    productsLoadFailed = true;
    render();
    showProductFeedback(translate(appShellFailed
      ? "Não foi possível abrir a página de produtos"
      : "Não foi possível carregar os produtos Verifique a conexão e tente novamente"));
    productsRetry.hidden = false;
  }
  if (!productsLoadFailed) {
    submitButton.disabled = false;
    searchInput.disabled = false;
    try {
      categoryNames = await loadCategories();
      productsRetry.hidden = true;
    } catch {
      categoryNames = [];
      showProductFeedback(translate("Não foi possível carregar as categorias Você ainda pode adicionar uma categoria nova"));
      productsRetry.hidden = false;
    }
    syncCategorySelect();
    buildCategoryList();
    render();
  }
  productsLoading = false;
  productsRetry.disabled = false;
};

void initializeProducts();
