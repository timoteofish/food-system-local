import {
  addCategoryRemote,
  ensureRestaurantTableRemote,
  loadCategories,
  loadProducts,
  loadRestaurantTablesRemote,
  removeCategoryRemote,
  saveMenuSettingsRemote,
} from "../../../shared/features/menu/index.js";
import {
  getMenuSettings,
  getSession,
} from "../../../shared/data/storage.js";
import { escapeHtml, formatPrice, parsePrice, safeImageUrl } from "../../../shared/utils/utils.js";
import { getLanguage, translate } from "../../../shared/i18n/i18n.js";
import { initAppShell, showToast } from "../../../shared/ui/ui.js";

let settings = getMenuSettings();
let products = [];
let categoryNames = [];
let restaurantTables = [];
let menuSearchQuery = "";
let saveSettingsTimer = null;
let menuLoadFailed = false;
let menuLoading = false;
let appShellInitialized = false;
let saveSequence = 0;
let pendingSettings = null;

const fields = {
  businessName: document.getElementById("businessName"),
  menuName: document.getElementById("menuName"),
  primaryColor: document.getElementById("primaryColor"),
  gradientStart: document.getElementById("gradientStart"),
  gradientEnd: document.getElementById("gradientEnd"),
  gradientAngle: document.getElementById("gradientAngle"),
  visualStyle: document.getElementById("visualStyle"),
  heroMood: document.getElementById("heroMood"),
  menuDensity: document.getElementById("menuDensity"),
  menuBanner: document.getElementById("menuBanner"),
  deliveryFee: document.getElementById("deliveryFeeSetting"),
  showAllProducts: document.getElementById("showAllProducts"),
  categoryList: document.getElementById("categoryList"),
};

const preview = {
  wrapper: document.getElementById("menuPreview"),
  business: document.getElementById("previewBusiness"),
  title: document.getElementById("previewTitle"),
  banner: document.getElementById("previewBanner"),
  categories: document.getElementById("previewCategories"),
  list: document.getElementById("menuList"),
};

const menuSearchInput = document.getElementById("menuSearch");
const generateQrCodeButton = document.getElementById("generateQrCode");
const qrCodeImage = document.getElementById("qrCodeImage");
const qrCodeLink = document.getElementById("qrCodeLink");
const qrCodeTable = document.getElementById("qrCodeTable");
const copyQrCodeLink = document.getElementById("copyQrCodeLink");
const qrCodeOpenPage = document.getElementById("qrCodeOpenPage");
const downloadQrPng = document.getElementById("downloadQrPng");
const downloadQrJpeg = document.getElementById("downloadQrJpeg");
const downloadQrPdf = document.getElementById("downloadQrPdf");
const tableShortcutList = document.getElementById("tableShortcutList");
const browserBar = document.querySelector(".browser-bar");
const menuLoadMessage = document.getElementById("menuLoadMessage");
const menuLoadRetry = document.getElementById("menuLoadRetry");
const menuSaveStatus = document.getElementById("menuSaveStatus");
const menuSaveRetry = document.getElementById("menuSaveRetry");

const setMenuEditorDisabled = (disabled) => {
  Object.values(fields).forEach((field) => {
    if (field && "disabled" in field) field.disabled = disabled;
  });
  fields.categoryList?.querySelectorAll("input").forEach((input) => {
    input.disabled = disabled || fields.showAllProducts.checked;
  });
  [menuSearchInput, qrCodeTable, generateQrCodeButton, copyQrCodeLink, qrCodeOpenPage, downloadQrPng, downloadQrJpeg, downloadQrPdf]
    .forEach((control) => {
      if (control) control.disabled = disabled;
    });
  tableShortcutList?.querySelectorAll("button").forEach((button) => {
    button.disabled = disabled;
  });
  menuSaveRetry.disabled = disabled;
};

const setMenuSaveStatus = (message, state = "") => {
  menuSaveStatus.textContent = message;
  menuSaveStatus.hidden = !message;
  if (state) menuSaveStatus.dataset.state = state;
  else menuSaveStatus.removeAttribute("data-state");
};

const persistMenuSettings = async (sequence) => {
  if (!pendingSettings) return;
  menuSaveRetry.disabled = true;
  try {
    await saveMenuSettingsRemote({
      ...pendingSettings,
      selectedCategories: [...pendingSettings.selectedCategories],
    });
    if (sequence === saveSequence) {
      setMenuSaveStatus(translate("Alterações salvas"), "success");
      menuSaveRetry.hidden = true;
    }
  } catch {
    if (sequence === saveSequence) {
      setMenuSaveStatus(translate("Não foi possível salvar as alterações do cardápio"), "error");
      menuSaveRetry.hidden = false;
    }
  } finally {
    if (sequence === saveSequence) menuSaveRetry.disabled = false;
  }
};

const monthlyOrderLimitByPlan = {
  gratis: 20,
};

const getOrderCapacity = () => {
  const plan = String(getSession()?.plan || "completo").toLowerCase();
  const limit = monthlyOrderLimitByPlan[plan] || Infinity;

  if (!Number.isFinite(limit)) {
    return {
      state: "ok",
      label: getLanguage() === "en" ? "No monthly order limit" : "Pedidos sem limite mensal",
    };
  }

  return {
    state: "ok",
    label: getLanguage() === "en" ? `Monthly limit: ${limit} orders` : `Limite mensal: ${limit} pedidos`,
  };
};

const syncOrderCapacityDots = () => {
  if (!browserBar) return;
  const capacity = getOrderCapacity();
  browserBar.dataset.orderCapacity = capacity.state;
  browserBar.title = capacity.label;
  browserBar.setAttribute("aria-label", translate(`Cardápio: ${capacity.label}`));
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

const getCategoryOptions = () => ["Todos", ...categoryNames];

const syncCategoryField = () => {
  const selected = Array.isArray(settings.selectedCategories) ? settings.selectedCategories : [];
  const showAll = settings.showAllProducts !== false;
  if (fields.showAllProducts) fields.showAllProducts.checked = showAll;
  if (!fields.categoryList) return;
  fields.categoryList.innerHTML = categoryNames
    .map(
      (category) => `
        <label class="category-check ${selected.includes(category) ? "is-active" : ""}">
          <input type="checkbox" value="${escapeHtml(category)}" ${selected.includes(category) ? "checked" : ""} />
          <span>${escapeHtml(category)}</span>
        </label>
      `
    )
    .join("");
  fields.categoryList.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
    checkbox.disabled = showAll;
  });
};

const applyPreviewGradient = () => {
  const start = fields.gradientStart?.value || settings.gradientStart || settings.primaryColor || "#c52236";
  const end = fields.gradientEnd?.value || settings.gradientEnd || "#191919";
  const angle = Number(fields.gradientAngle?.value ?? settings.gradientAngle ?? 140);
  preview.wrapper.style.setProperty("--menu-gradient", `linear-gradient(${angle}deg, ${start}, ${end})`);
  preview.wrapper.style.setProperty("--menu-gradient-start", start);
  preview.wrapper.style.setProperty("--menu-gradient-end", end);
  preview.wrapper.style.setProperty("--menu-gradient-angle", `${angle}deg`);
};

const getFilteredProducts = () => {
  if (menuLoadFailed) return [];

  let filtered = products.filter((item) => item.active);
  if (!settings.showAllProducts) {
    const selected = new Set(settings.selectedCategories || []);
    if (selected.size) {
      filtered = filtered.filter((item) => selected.has(item.category));
    }
  }

  const query = menuSearchQuery.trim().toLowerCase();
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

const getCustomerMenuUrl = async () => {
  let publicBase = String(window.FOOD_SYSTEM_PUBLIC_MENU_URL || "").trim();
  if (!publicBase) {
    try {
      publicBase = await window.__TAURI__?.core?.invoke?.("public_menu_base_url") || "";
    } catch {
      // Browser development may publish from the current origin.
    }
  }
  let baseUrl = window.location.origin;
  if (publicBase) {
    let parsedBase;
    try { parsedBase = new URL(publicBase); }
    catch { throw new Error("Endereço público do cardápio inválido"); }
    if (parsedBase.protocol !== "https:" || parsedBase.username || parsedBase.password || parsedBase.search || parsedBase.hash || parsedBase.pathname !== "/") {
      throw new Error("O endereço público do cardápio deve ser uma origem HTTPS, sem caminho adicional");
    }
    baseUrl = parsedBase.origin;
  } else if (["tauri.localhost", "localhost", "127.0.0.1", ""].includes(window.location.hostname)) {
    throw new Error("Configure FOOD_SYSTEM_PUBLIC_MENU_URL com o endereço HTTPS acessível aos clientes");
  } else if (window.location.protocol !== "https:") {
    throw new Error("O endereço público do cardápio deve usar HTTPS");
  }
  const url = new URL("/pages/qr-code-final/index.html", baseUrl);
  const tableName = qrCodeTable?.value.trim();
  const table = restaurantTables.find((item) => item.name.toLowerCase() === tableName?.toLowerCase());
  if (table?.public_token) {
    url.searchParams.set("mesa_token", table.public_token);
  } else {
    const businessId = getSession()?.businessId;
    if (businessId) url.searchParams.set("negocio", businessId);
    if (tableName) url.searchParams.set("mesa", tableName);
  }
  return url.href;
};

const renderQrCode = async () => {
  const tableName = qrCodeTable?.value.trim();
  if (tableName) {
    const existing = restaurantTables.find((item) => item.name.toLowerCase() === tableName.toLowerCase());
    if (!existing?.public_token) {
      const saved = await ensureRestaurantTableRemote(tableName);
      restaurantTables = [
        ...restaurantTables.filter((item) => item.id !== saved.id && item.name.toLowerCase() !== saved.name.toLowerCase()),
        saved,
      ];
    }
  }

  const targetUrl = await getCustomerMenuUrl();
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(targetUrl)}`;
  if (qrCodeImage) qrCodeImage.src = qrUrl;
  if (qrCodeLink) qrCodeLink.value = targetUrl;
};

const renderMenuLoadError = (message) => {
  menuLoadFailed = true;
  products = [];
  categoryNames = [];
  syncCategoryField();
  setMenuEditorDisabled(true);
  menuLoadMessage.textContent = message;
  menuLoadMessage.hidden = false;
  menuLoadRetry.hidden = false;
  applyPreviewGradient();
  preview.business.textContent = settings.businessName || "Food System";
  preview.title.textContent = settings.menuName || translate("Cardápio");
  preview.banner.textContent = settings.menuBanner || "";
  preview.banner.hidden = !settings.menuBanner?.trim();
  preview.categories.innerHTML = "";
  preview.list.innerHTML = `<div class="menu-preview-empty">${translate("Não foi possível carregar os produtos e as categorias.")}</div>`;
  syncOrderCapacityDots();
};

const loadQrImageForCanvas = async () => {
  if (!qrCodeImage?.src) {
    throw new Error("QR Code ainda não foi gerado");
  }

  const image = new Image();
  image.crossOrigin = "anonymous";
  image.referrerPolicy = "no-referrer";

  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error("Não foi possível carregar o QR Code para download"));
    image.src = qrCodeImage.src;
  });

  return image;
};

const buildQrCanvas = async (mimeType = "image/png") => {
  const image = await loadQrImageForCanvas();
  const canvas = document.createElement("canvas");
  const padding = 48;
  const size = Math.max(image.naturalWidth || 320, image.naturalHeight || 320);
  const finalSize = size + padding * 2;
  const context = canvas.getContext("2d");

  canvas.width = finalSize;
  canvas.height = finalSize + 96;

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.drawImage(image, padding, padding, size, size);

  context.fillStyle = "#191919";
  context.font = "700 26px Inter, sans-serif";
  context.textAlign = "center";
  context.fillText(settings.businessName || "Food System", canvas.width / 2, finalSize + 38);

  context.fillStyle = "#686868";
  context.font = "500 18px Inter, sans-serif";
  context.fillText(translate("Escaneie para abrir o cardápio"), canvas.width / 2, finalSize + 68);

  return {
    canvas,
    dataUrl: canvas.toDataURL(mimeType, mimeType === "image/jpeg" ? 0.96 : undefined),
  };
};

const triggerFileDownload = (href, filename) => {
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
};

const downloadQrAsImage = async (format) => {
  const mimeType = format === "jpeg" ? "image/jpeg" : "image/png";
  const { dataUrl } = await buildQrCanvas(mimeType);
  triggerFileDownload(dataUrl, `food-system-cardapio-qr.${format}`);
};

const escapePdfText = (value) =>
  String(value || "").replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

const downloadQrAsPdf = async () => {
  const { canvas, dataUrl } = await buildQrCanvas("image/jpeg");
  const jpegData = dataUrl.split(",")[1];
  const jpegBytes = atob(jpegData);
  const imageLength = jpegBytes.length;
  const imageWidth = canvas.width;
  const imageHeight = canvas.height;

  const objects = [];
  let offset = 0;
  const push = (chunk) => {
    objects.push({ offset, chunk });
    offset += chunk.length;
  };

  const content = `q\n${imageWidth} 0 0 ${imageHeight} 0 0 cm\n/Im0 Do\nQ\n`;

  let pdf = "%PDF-1.4\n";
  offset = pdf.length;
  push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  push("2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj\n");
  push(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${imageWidth} ${imageHeight}] /Resources << /XObject << /Im0 4 0 R >> /Font << /F1 6 0 R >> >> /Contents 5 0 R >>\nendobj\n`);
  push(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imageWidth} /Height ${imageHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imageLength} >>\nstream\n${jpegBytes}\nendstream\nendobj\n`);
  push(`5 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`);
  push("6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n");

  pdf += objects.map((item) => item.chunk).join("");
  const xrefOffset = pdf.length;
  pdf += `xref\n0 7\n0000000000 65535 f \n`;
  pdf += objects
    .map((item) => `${String(item.offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  pdf += `trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  const blob = new Blob([pdf], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  triggerFileDownload(url, "food-system-cardapio-qr.pdf");
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const render = () => {
  if (menuLoadFailed) return;

  preview.wrapper.dataset.style = settings.style;
  preview.wrapper.style.setProperty("--menu-accent", settings.primaryColor);
  preview.wrapper.dataset.mood = settings.heroMood || "hero";
  const densityValue = Number(settings.menuDensity ?? 50);
  preview.wrapper.dataset.density =
    densityValue < 34 ? "spacious" : densityValue > 66 ? "compact" : "balanced";
  preview.business.textContent = settings.businessName || "Food System";
  preview.title.textContent = settings.menuName || translate("Cardápio digital");
  preview.banner.textContent = settings.menuBanner?.trim() || "";
  preview.banner.hidden = !settings.menuBanner?.trim();
  applyPreviewGradient();

  preview.categories.innerHTML = getCategoryOptions()
    .map(
      (category) =>
        `<button class="chip ${(settings.showAllProducts || (settings.selectedCategories || []).includes(category) || category === "Todos") ? "active" : ""}" type="button" data-category="${escapeHtml(category)}">${category === "Todos" ? escapeHtml(translate("all")) : escapeHtml(category)}</button>`
    )
    .join("");

  const visibleProducts = getFilteredProducts();
  preview.list.innerHTML = visibleProducts.length
    ? visibleProducts
        .map((item) => {
          return `
        <article class="menu-item" data-id="${escapeHtml(item.id)}">
            ${productImage(item)}
            <div>
            <strong data-merchant-content>${escapeHtml(item.name)}</strong>
            <p data-merchant-content>${escapeHtml(item.description || item.category)}</p>
          </div>
          <div class="menu-action">
            <div class="menu-action-wrapper">
              <span class="menu-price">${productPriceHtml(item)}</span>
              <span class="choose-btn" aria-hidden="true">${translate("Adicionar")}</span>
            </div>
          </div>
        </article>
      `;
        })
        .join("")
    : `<div class="menu-preview-empty">${translate("Nenhum produto ativo no cardápio")}</div>`;

  syncOrderCapacityDots();
};

const syncFromFields = () => {
  if (menuLoadFailed || menuLoading) return;

  const selectedCategories = Array.from(
    fields.categoryList?.querySelectorAll('input[type="checkbox"]:checked') || []
  ).map((input) => input.value);
  settings = {
    businessName: fields.businessName.value,
    menuName: fields.menuName.value,
    primaryColor: fields.primaryColor.value,
    gradientStart: fields.gradientStart.value,
    gradientEnd: fields.gradientEnd.value,
    gradientAngle: fields.gradientAngle.value,
    style: fields.visualStyle.value,
    heroMood: fields.heroMood.value,
    menuDensity: fields.menuDensity.value,
    menuBanner: fields.menuBanner?.value || "",
    deliveryFee: Number(fields.deliveryFee?.value || 0),
    showAllProducts: fields.showAllProducts?.checked ?? true,
    selectedCategories,
  };
  render();
  pendingSettings = { ...settings, selectedCategories: [...selectedCategories] };
  const sequence = ++saveSequence;
  setMenuSaveStatus(translate("Salvando alterações"), "saving");
  menuSaveRetry.hidden = true;
  window.clearTimeout(saveSettingsTimer);
  saveSettingsTimer = window.setTimeout(() => void persistMenuSettings(sequence), 450);
};

Object.entries(fields).forEach(([key, field]) => {
  if (!field) return;
  if (key === "categoryList") return;
  if (key === "showAllProducts") {
    field.checked = settings.showAllProducts !== false;
  } else {
    field.value =
        key === "visualStyle"
          ? settings.style
          : key === "heroMood"
            ? settings.heroMood || "hero"
          : key === "menuDensity"
              ? settings.menuDensity ?? 50
              : key === "menuBanner"
                ? settings.menuBanner || ""
              : key === "deliveryFee"
                ? settings.deliveryFee ?? 0
              : key === "gradientAngle"
                ? settings.gradientAngle ?? 135
                  : key === "gradientStart"
                    ? settings.gradientStart || settings.primaryColor || "#c52236"
                  : key === "gradientEnd"
                    ? settings.gradientEnd || "#191919"
              : settings[key] || "";
  }
  field.addEventListener("input", syncFromFields);
  field.addEventListener("change", syncFromFields);
});

menuSaveRetry.addEventListener("click", () => {
  window.clearTimeout(saveSettingsTimer);
  const sequence = ++saveSequence;
  setMenuSaveStatus(translate("Salvando alterações"), "saving");
  menuSaveRetry.hidden = true;
  void persistMenuSettings(sequence);
});

tableShortcutList?.replaceChildren(
  ...Array.from({ length: 12 }, (_, index) => {
    const tableNumber = String(index + 1).padStart(2, "0");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "table-shortcut";
    button.textContent = tableNumber;
    button.addEventListener("click", () => {
      if (qrCodeTable) qrCodeTable.value = `Mesa ${tableNumber}`;
      renderQrCode()
        .then(() => showToast(translate(`QR da mesa ${tableNumber} pronto`)))
        .catch((error) => showToast(translate(error.message || "Não foi possível criar o QR da mesa"), { type: "error" }));
    });
    return button;
  })
);

fields.showAllProducts?.addEventListener("change", () => {
  syncCategoryField();
  syncFromFields();
});

fields.categoryList?.addEventListener("change", syncFromFields);

menuSearchInput?.addEventListener("input", (event) => {
  menuSearchQuery = event.target.value || "";
  render();
});

preview.categories.addEventListener("click", (event) => {
  const button = event.target.closest("[data-category]");
  if (!button) return;
  const category = button.dataset.category;
  if (category === "Todos") {
    fields.showAllProducts.checked = true;
    syncCategoryField();
    syncFromFields();
    return;
  }

  fields.showAllProducts.checked = false;
  const input = fields.categoryList?.querySelector(`input[value="${CSS.escape(category)}"]`);
  if (input) {
    input.checked = !input.checked;
    const wrapper = input.closest(".category-check");
    wrapper?.classList.toggle("is-active", input.checked);
  }
  syncFromFields();
});

generateQrCodeButton?.addEventListener("click", () => {
  renderQrCode()
    .then(() => showToast(translate("QR Code gerado")))
    .catch((error) => showToast(translate(error.message || "Não foi possível atualizar o QR Code"), { type: "error" }));
});

qrCodeTable?.addEventListener("change", () => {
  renderQrCode().catch(() => {});
});

qrCodeOpenPage?.addEventListener("click", () => {
  const popup = window.open("about:blank", "_blank");
  if (popup) popup.opener = null;
  renderQrCode()
    .then(() => {
      if (popup && qrCodeLink?.value) popup.location.href = qrCodeLink.value;
    })
    .catch((error) => {
      popup?.close();
      showToast(translate(error.message || "Não foi possível abrir a página"), { type: "error" });
    });
});
copyQrCodeLink?.addEventListener("click", async () => {
  try {
    await renderQrCode();
    const value = qrCodeLink?.value || "";
    if (!value) throw new Error("Gere o QR Code antes de copiar o link");
    await navigator.clipboard.writeText(value);
    showToast(translate("Link copiado"));
  } catch {
    qrCodeLink?.focus();
    qrCodeLink?.select();
    showToast(translate("Copie o link manualmente"), { type: "error" });
  }
});
downloadQrPng?.addEventListener("click", async () => {
  try {
    await downloadQrAsImage("png");
  } catch (error) {
      showToast(translate(error.message || "Não foi possível baixar o QR em PNG"), { type: "error" });
  }
});
downloadQrJpeg?.addEventListener("click", async () => {
  try {
    await downloadQrAsImage("jpeg");
  } catch (error) {
      showToast(translate(error.message || "Não foi possível baixar o QR em JPEG"), { type: "error" });
  }
});
downloadQrPdf?.addEventListener("click", async () => {
  try {
    await downloadQrAsPdf();
  } catch (error) {
      showToast(translate(error.message || "Não foi possível baixar o QR em PDF"), { type: "error" });
  }
});

const initializeMenu = async () => {
  if (menuLoading) return false;
  menuLoading = true;
  menuLoadRetry.hidden = true;
  menuLoadRetry.disabled = true;
  menuLoadMessage.hidden = true;
  setMenuEditorDisabled(true);
  try {
    if (!appShellInitialized) {
      await initAppShell({ activeNav: "menu" });
      appShellInitialized = true;
    }
    products = (await loadProducts()).map(normalizeProduct);
    categoryNames = await loadCategories();
    restaurantTables = await loadRestaurantTablesRemote();
  } catch (error) {
    renderMenuLoadError(translate(error.message || "Não foi possível carregar o cardápio pela API"));
    return false;
  } finally {
    menuLoading = false;
    menuLoadRetry.disabled = false;
  }

  menuLoadFailed = false;
  if (!Array.isArray(settings.selectedCategories)) {
    settings.selectedCategories = [];
  }
  if (typeof settings.showAllProducts !== "boolean") {
    settings.showAllProducts = true;
  }
  if (fields.gradientStart && !settings.gradientStart) settings.gradientStart = settings.primaryColor || "#c52236";
  if (fields.gradientEnd && !settings.gradientEnd) settings.gradientEnd = "#191919";
  if (fields.gradientAngle && settings.gradientAngle == null) settings.gradientAngle = 140;
  if (fields.gradientStart) fields.gradientStart.value = settings.gradientStart;
  if (fields.gradientEnd) fields.gradientEnd.value = settings.gradientEnd;
  if (fields.gradientAngle) fields.gradientAngle.value = String(settings.gradientAngle);
  syncCategoryField();
  setMenuEditorDisabled(false);
  render();
  renderQrCode().catch(() => {});
  return true;
};

menuLoadRetry.addEventListener("click", () => void initializeMenu());
void initializeMenu();
