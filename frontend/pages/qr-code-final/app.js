import { createOrder as apiCreateOrder, fetchPublicMenu, fetchPublicMenuByTableToken } from "../../shared/api/client.js";
import { clearCart, getCart, saveCart } from "../../shared/data/storage.js";
import { escapeHtml, formatPrice, parsePrice, safeImageUrl } from "../../shared/utils/utils.js";
import { showToast } from "../../shared/ui/ui.js";

let settings = {
  businessName: "",
  menuName: "",
  primaryColor: "#0f766e",
  style: "clean",
  gradientStart: "#0f766e",
  gradientEnd: "#1f2a24",
  gradientAngle: 140,
  menuBanner: "",
  showAllProducts: true,
  selectedCategories: [],
};
let products = [];
let categories = [];
let searchQuery = "";
let selectedCategory = "Todos";
const params = new URLSearchParams(window.location.search);
const tableName = params.get("mesa")?.trim() || "Mesa não definida";
const publicBusinessId = params.get("negocio")?.trim() || "";
const tableToken = params.get("mesa_token")?.trim() || "";
let currentTableName = tableName;

const cart = { ...getCart() };

const elements = {
  preview: document.getElementById("customerMenuPreview"),
  hero: document.getElementById("customerHero"),
  businessName: document.getElementById("customerBusinessName"),
  subtitle: document.getElementById("customerMenuSubtitle"),
  banner: document.getElementById("customerMenuBanner"),
  search: document.getElementById("customerMenuSearch"),
  categories: document.getElementById("customerCategories"),
  list: document.getElementById("customerMenuList"),
  bagButtons: [document.getElementById("customerMenuBag")].filter(Boolean),
  bagCounts: [document.getElementById("customerMenuBagCount")].filter(Boolean),
  bagBackdrop: document.getElementById("customerBagBackdrop"),
  bagPanel: document.getElementById("customerBagPanel"),
  bagClose: document.getElementById("customerBagClose"),
  bagItems: document.getElementById("customerBagItems"),
  bagTotal: document.getElementById("customerBagTotal"),
  bagConfirm: document.getElementById("customerBagConfirm"),
  customerName: document.getElementById("customerNameInput"),
  orderType: document.getElementById("customerOrderType"),
  deliveryFields: document.getElementById("customerDeliveryFields"),
  deliveryStreet: document.getElementById("deliveryStreet"),
  deliveryNumber: document.getElementById("deliveryNumber"),
  deliveryCity: document.getElementById("deliveryCity"),
  deliveryFee: document.getElementById("deliveryFee"),
  customerTable: document.getElementById("customerTableDisplay"),
  paymentMethod: document.getElementById("customerPaymentMethod"),
  paymentNote: document.getElementById("customerPaymentNote"),
  success: document.getElementById("customerSuccess"),
};

const persistCart = () => {
  saveCart(cart);
};

const productImage = (item) => {
  const image = safeImageUrl(item.image);
  if (image) {
    return `<img class="preview-image" src="${escapeHtml(image)}" alt="${escapeHtml(item.name)}" />`;
  }
  return `<div class="preview-image preview-image--empty">${escapeHtml(String(item.name || "P").slice(0, 2).toUpperCase())}</div>`;
};

const normalizeProduct = (item) => ({
  ...item,
  id: String(item.id),
  name: item.name || "Produto",
  description: item.description || "",
  category: typeof item.category === "object" ? item.category?.name || "" : item.category || "",
  image: item.image || item.image_url || "",
  active: item.active ?? item.status === "active",
});

const productPriceHtml = (item) => {
  return formatPrice(parsePrice(item.price));
};

const getProductPrice = (item) => parsePrice(item.price);

const getOrderCode = (order) =>
  String(order?.orderCode || order?.order_code || order?.order_number || order?.id || "pedido")
    .slice(-6)
    .toUpperCase();

const getPaymentLabel = (method) => {
  if (method === "credito") return "Cartão de crédito";
  if (method === "debito") return "Cartão de débito";
  if (method === "dinheiro_balcao") return "Balcão";
  return "Pix";
};

const applyHeroTheme = () => {
  const accent = settings.primaryColor || "#0f766e";
  const start = settings.gradientStart || accent;
  const end = settings.gradientEnd || "#1f2a24";
  const angle = Number(settings.gradientAngle ?? 135);
  elements.preview.dataset.style = settings.style || "clean";
  elements.preview.dataset.mood = settings.heroMood || "hero";
  const densityValue = Number(settings.menuDensity ?? 50);
  elements.preview.dataset.density =
    densityValue < 34 ? "spacious" : densityValue > 66 ? "compact" : "balanced";
  elements.preview.style.setProperty("--menu-accent", accent);
  elements.preview.style.setProperty("--menu-gradient", `linear-gradient(${angle}deg, ${start}, ${end})`);
};

const getVisibleProducts = () => {
  const selected = new Set(settings.selectedCategories || []);
  let filtered = products.filter((item) => item.active);

  if (settings.showAllProducts === false && selected.size) {
    filtered = filtered.filter((item) => selected.has(item.category));
  }

  if (selectedCategory !== "Todos") {
    filtered = filtered.filter((item) => item.category === selectedCategory);
  }

  const query = searchQuery.trim().toLowerCase();
  if (query) {
    filtered = filtered.filter(
      (item) =>
        item.name?.toLowerCase().includes(query) ||
        item.description?.toLowerCase().includes(query) ||
        item.category?.toLowerCase().includes(query)
    );
  }

  return filtered;
};

const getCartEntries = () =>
  Object.entries(cart)
    .filter(([id, quantity]) => Boolean(id) && Number(quantity) > 0)
    .map(([id, quantity]) => {
      const product = products.find((item) => item.id === id);
      return product ? { product, quantity: Number(quantity) } : null;
    })
    .filter(Boolean);

const getCartTotal = () =>
  getCartEntries().reduce((sum, entry) => sum + getProductPrice(entry.product) * entry.quantity, 0);

const updateBagCount = () => {
  const totalItems = Object.values(cart).reduce((sum, quantity) => sum + Number(quantity || 0), 0);
  elements.bagCounts.forEach((node) => {
    node.textContent = String(totalItems);
  });
};

const renderCategories = () => {
  const availableCategories = ["Todos", ...categories.filter((category) => {
    if (settings.showAllProducts !== false) return true;
    const selected = new Set(settings.selectedCategories || []);
    return selected.size ? selected.has(category) : true;
  })];

  if (!availableCategories.includes(selectedCategory)) {
    selectedCategory = "Todos";
  }

  elements.categories.innerHTML = availableCategories
    .map(
      (category) =>
        `<button class="chip ${selectedCategory === category ? "active" : ""}" type="button" data-category="${escapeHtml(category)}">${escapeHtml(category)}</button>`
    )
    .join("");
};

const renderBagPanel = () => {
  const entries = getCartEntries();
  elements.bagItems.innerHTML = entries.length
    ? entries
        .map(
          ({ product, quantity }) => {
            const image = safeImageUrl(product.image);
            return `
            <div class="bag-panel__item">
              <div class="bag-panel__item-main">
                ${
                  image
                    ? `<img class="bag-panel__item-thumb" src="${escapeHtml(image)}" alt="${escapeHtml(product.name)}" />`
                    : `<div class="bag-panel__item-thumb">${escapeHtml(String(product.name || "P").slice(0, 2).toUpperCase())}</div>`
                }
                <div class="bag-panel__item-info">
                  <span class="bag-panel__item-name">${escapeHtml(product.name)}</span>
                  <span class="bag-panel__item-meta">${escapeHtml(product.category || "Pedido")}</span>
                </div>
                <strong class="bag-panel__item-price">${formatPrice(getProductPrice(product) * quantity)}</strong>
              </div>
              <div class="bag-panel__item-bottom">
                <div class="bag-panel__qty">
                  <button type="button" data-cart-action="decrease" data-id="${product.id}">-</button>
                  <span class="qty-value">${quantity}</span>
                  <button type="button" data-cart-action="increase" data-id="${product.id}">+</button>
                </div>
                <span>${formatPrice(getProductPrice(product))} un.</span>
              </div>
            </div>
          `;
          }
        )
        .join("")
    : '<div class="bag-panel__empty">Sacola vazia</div>';

  elements.bagTotal.textContent = formatPrice(getCartTotal());
  elements.bagConfirm.disabled = entries.length === 0;
  if (elements.paymentNote) {
    const method = elements.paymentMethod?.value || "pix";
    elements.paymentNote.textContent =
      method === "dinheiro_balcao"
        ? "Para pagar em dinheiro, débito ou crédito com o balconista"
        : "Pagamento no sistema";
  }
};

const renderList = () => {
  const visibleProducts = getVisibleProducts();
  elements.list.innerHTML = visibleProducts.length
    ? visibleProducts
        .map((item) => {
          const quantity = cart[item.id] || 0;
          const action = quantity
            ? `
              <div class="qty-controls" data-id="${item.id}">
                <button class="qty-btn qty-decrease" data-id="${item.id}">-</button>
                <span class="qty-value">${quantity}</span>
                <button class="qty-btn qty-increase" data-id="${item.id}">+</button>
              </div>
            `
            : `<button class="choose-btn" data-id="${item.id}">${productPriceHtml(item)}</button>`;

          return `
            <article class="menu-item" data-id="${item.id}">
              ${productImage(item)}
              <div>
                <strong>${escapeHtml(item.name)}</strong>
                <p>${escapeHtml(item.description || item.category)}</p>
              </div>
              <div class="menu-action">
                <div class="menu-action-wrapper">
                  ${quantity ? `<span class="menu-price">${productPriceHtml(item)}</span>` : ""}
                  ${action}
                </div>
              </div>
            </article>
          `;
        })
        .join("")
    : '<div class="customer-empty">Nenhum produto encontrado</div>';
};

const render = () => {
  elements.businessName.textContent = settings.businessName || "Food System";
  elements.subtitle.textContent = settings.menuName || "Cardápio digital";
  if (elements.customerTable) elements.customerTable.textContent = currentTableName;

  if (settings.menuBanner?.trim()) {
    elements.banner.hidden = false;
    elements.banner.textContent = settings.menuBanner.trim();
  } else {
    elements.banner.hidden = true;
    elements.banner.textContent = "";
  }

  applyHeroTheme();
  renderCategories();
  renderList();
  updateBagCount();
  renderBagPanel();
};

const loadPublicMenuData = async () => {
  if (!tableToken && !publicBusinessId) throw new Error("Cardápio sem mesa informada.");

  const data = tableToken
    ? await fetchPublicMenuByTableToken(tableToken)
    : await fetchPublicMenu(publicBusinessId);
  settings = {
    ...settings,
    businessId: data.business_id || publicBusinessId || settings.businessId,
    businessName: data.business_name || settings.businessName,
    menuName: data.menu_name || settings.menuName,
    primaryColor: data.primary_color || settings.primaryColor,
    style: data.style || settings.style,
    gradientStart: data.gradient_start || settings.gradientStart,
    gradientEnd: data.gradient_end || settings.gradientEnd,
    gradientAngle: data.gradient_angle || settings.gradientAngle,
    menuBanner: data.menu_banner || settings.menuBanner,
    showAllProducts: data.show_all_products ?? settings.showAllProducts,
    selectedCategories: data.selected_categories || settings.selectedCategories || [],
  };
  products = Array.isArray(data.products) ? data.products.map(normalizeProduct) : [];
  categories = Array.isArray(data.categories)
    ? data.categories.map((category) => category.name || category).filter(Boolean)
    : [];
  if (data.table?.name && elements.customerTable) {
    currentTableName = data.table.name;
    elements.customerTable.textContent = currentTableName;
  }
};

const placeCustomerOrder = async ({ entries, total, paymentMethod, customerName }) => {
  const businessId = publicBusinessId || settings.businessId || "";
  if (!businessId && !tableToken) throw new Error("Cardápio sem mesa informada.");
  const tableLabel = elements.customerTable?.textContent?.trim() || currentTableName;
  const isDelivery = elements.orderType?.value === "delivery";
  const delivery = isDelivery ? {
    address: { street: elements.deliveryStreet.value.trim(), number: elements.deliveryNumber.value.trim(), city: elements.deliveryCity.value.trim() },
    fee: Number(elements.deliveryFee.value || 0),
  } : null;

  const data = await apiCreateOrder(
    businessId,
    {
      customer_name: customerName,
      customer_phone: "0000000000",
      notes: `${isDelivery ? "Entrega" : `Mesa: ${tableLabel}`} | Pagamento: ${getPaymentLabel(paymentMethod)}`,
    },
    entries.map(({ product, quantity }) => ({
      product_id: product.id,
      quantity,
    })),
    tableToken,
    delivery
  );

  return data.order;
};

const openBagPanel = () => {
  renderBagPanel();
  elements.bagBackdrop.hidden = false;
  elements.bagPanel.hidden = false;
  elements.bagBackdrop.classList.add("is-open");
  elements.bagPanel.classList.add("is-open");
  elements.bagPanel.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
};

const closeBagPanel = () => {
  elements.bagBackdrop.classList.remove("is-open");
  elements.bagPanel.classList.remove("is-open");
  elements.bagPanel.setAttribute("aria-hidden", "true");
  elements.bagBackdrop.hidden = true;
  elements.bagPanel.hidden = true;
  document.body.classList.remove("modal-open");
};

const updateCartQuantity = (id, nextQuantity) => {
  if (!id) return;
  if (nextQuantity <= 0) delete cart[id];
  else cart[id] = nextQuantity;
  persistCart();
  render();
};

const addToCart = (id) => {
  if (!id) return;
  cart[id] = (cart[id] || 0) + 1;
  persistCart();
  render();
};

elements.search?.addEventListener("input", (event) => {
  searchQuery = event.target.value || "";
  renderList();
});

elements.categories.addEventListener("click", (event) => {
  const button = event.target.closest("[data-category]");
  if (!button) return;
  selectedCategory = button.dataset.category || "Todos";
  render();
});

elements.list.addEventListener("click", (event) => {
  const chooseButton = event.target.closest(".choose-btn");
  if (chooseButton) {
    addToCart(chooseButton.dataset.id);
    return;
  }

  const qtyButton = event.target.closest(".qty-btn");
  if (!qtyButton) return;
  const id = qtyButton.dataset.id;
  const current = cart[id] || 0;
  updateCartQuantity(id, qtyButton.classList.contains("qty-increase") ? current + 1 : current - 1);
});

elements.bagItems.addEventListener("click", (event) => {
  const button = event.target.closest("[data-cart-action][data-id]");
  if (!button) return;
  const id = button.dataset.id;
  const current = cart[id] || 0;
  updateCartQuantity(id, button.dataset.cartAction === "increase" ? current + 1 : current - 1);
});

elements.bagButtons.forEach((button) => button.addEventListener("click", openBagPanel));
elements.bagClose?.addEventListener("click", closeBagPanel);
elements.bagBackdrop?.addEventListener("click", closeBagPanel);
elements.paymentMethod?.addEventListener("change", renderBagPanel);
elements.orderType?.addEventListener("change", () => {
  const delivery = elements.orderType.value === "delivery";
  elements.deliveryFields.hidden = !delivery;
  elements.customerTable.closest(".customer-table-fixed")?.toggleAttribute("hidden", delivery);
});

elements.bagConfirm?.addEventListener("click", async () => {
  const entries = getCartEntries();
  if (!entries.length) return;

  const customerName = elements.customerName.value.trim() || "Cliente";
  const paymentMethod = elements.paymentMethod.value || "pix";
  const totalBeforeClear = getCartTotal();

  try {
    const order = await placeCustomerOrder({
      entries,
      total: totalBeforeClear,
      paymentMethod,
      customerName,
    });

    Object.keys(cart).forEach((key) => delete cart[key]);
    clearCart();
    closeBagPanel();
    render();
    elements.customerName.value = "";
    elements.paymentMethod.value = "pix";
    const orderCode = getOrderCode(order);
    const paymentLabel = getPaymentLabel(paymentMethod);
    if (elements.success) {
      elements.success.hidden = false;
      elements.success.innerHTML = `
        <strong>Pedido enviado</strong>
        <span>Código ${escapeHtml(orderCode)} · ${escapeHtml(currentTableName)} · ${escapeHtml(formatPrice(totalBeforeClear))} · ${escapeHtml(paymentLabel)}</span>
      `;
    }
    showToast(`Pedido ${orderCode} enviado para confirmação`);
  } catch (error) {
    showToast(error.message || "Nao foi possivel enviar o pedido.", { type: "error" });
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !elements.bagPanel.hidden) {
    closeBagPanel();
  }
});

(async () => {
  try {
    await loadPublicMenuData();
  } catch (error) {
    elements.list.innerHTML = `<p class="menu-empty">${escapeHtml(error.message || "Não foi possível carregar este cardápio.")}</p>`;
    elements.businessName.textContent = "Cardápio indisponível";
    elements.subtitle.textContent = "";
    return;
  }
  render();
})();
