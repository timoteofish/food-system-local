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
import { initAppShell, showToast } from "../../../shared/ui/ui.js";

let settings = getMenuSettings();
let products = [];
let categoryNames = [];
let restaurantTables = [];
let menuSearchQuery = "";
let selectedTheme = "default";
let saveSettingsTimer = null;
let menuLoadFailed = false;

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
  showAllProducts: document.getElementById("showAllProducts"),
  categoryList: document.getElementById("categoryList"),
};

const preview = {
  wrapper: document.getElementById("menuPreview"),
  business: document.getElementById("previewBusiness"),
  title: document.getElementById("previewTitle"),
  categories: document.getElementById("previewCategories"),
  list: document.getElementById("menuList"),
};

const themeMap = {
  default: { label: "Food QR", accent: "#0f766e", gradientStart: "#0f766e", gradientEnd: "#1f2a24", gradientAngle: 140 },
  sunset: { label: "Sunset Grill", accent: "#b45309", gradientStart: "#b45309", gradientEnd: "#7c2d12", gradientAngle: 135 },
  forest: { label: "Fresh Market", accent: "#15803d", gradientStart: "#15803d", gradientEnd: "#14532d", gradientAngle: 135 },
  midnight: { label: "Midnight", accent: "#1f2a24", gradientStart: "#1f2a24", gradientEnd: "#315047", gradientAngle: 135 },
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

const monthlyOrderLimitByPlan = {
  gratis: 20,
};

const getOrderCapacity = () => {
  const plan = String(getSession()?.plan || "completo").toLowerCase();
  const limit = monthlyOrderLimitByPlan[plan] || Infinity;

  if (!Number.isFinite(limit)) {
    return { state: "ok", label: "Pedidos sem limite mensal" };
  }

  return { state: "ok", label: `Limite mensal: ${limit} pedidos` };
};

const syncOrderCapacityDots = () => {
  if (!browserBar) return;
  const capacity = getOrderCapacity();
  browserBar.dataset.orderCapacity = capacity.state;
  browserBar.title = capacity.label;
  browserBar.setAttribute("aria-label", `Cardápio: ${capacity.label}`);
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
          <input type="checkbox" value="${category}" ${selected.includes(category) ? "checked" : ""} />
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
  const start = fields.gradientStart?.value || settings.gradientStart || settings.primaryColor || "#0f766e";
  const end = fields.gradientEnd?.value || settings.gradientEnd || "#1f2a24";
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

const getCustomerMenuUrl = () => {
  const url = new URL("../../qr-code-final/index.html", window.location.href);
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

  const targetUrl = getCustomerMenuUrl();
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(targetUrl)}`;
  if (qrCodeImage) qrCodeImage.src = qrUrl;
  if (qrCodeLink) qrCodeLink.value = targetUrl;
};

const renderMenuLoadError = (message) => {
  menuLoadFailed = true;
  products = [];
  categoryNames = [];
  syncCategoryField();
  applyPreviewGradient();
  preview.business.textContent = settings.businessName || "Food System";
  preview.title.textContent = settings.menuName || "Cardápio";
  preview.categories.innerHTML = "";
  preview.list.innerHTML = `<div class="menu-preview-empty">${escapeHtml(message)}</div>`;
  renderQrCode().catch(() => {});
  syncOrderCapacityDots();
};

const loadQrImageForCanvas = async () => {
  if (!qrCodeImage?.src) {
    throw new Error("QR Code ainda não foi gerado.");
  }

  const image = new Image();
  image.crossOrigin = "anonymous";
  image.referrerPolicy = "no-referrer";

  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error("Não foi possível carregar o QR Code para download."));
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

  context.fillStyle = "#1f2a24";
  context.font = "700 26px Inter, sans-serif";
  context.textAlign = "center";
  context.fillText(settings.businessName || "Food System", canvas.width / 2, finalSize + 38);

  context.fillStyle = "#68746d";
  context.font = "500 18px Inter, sans-serif";
  context.fillText("Escaneie para abrir o cardápio", canvas.width / 2, finalSize + 68);

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
  preview.title.textContent = settings.menuName || "Cardápio digital";
  applyPreviewGradient();

  preview.categories.innerHTML = getCategoryOptions()
    .map(
      (category) =>
        `<button class="chip ${(settings.showAllProducts || (settings.selectedCategories || []).includes(category) || category === "Todos") ? "active" : ""}" type="button" data-category="${escapeHtml(category)}">${escapeHtml(category)}</button>`
    )
    .join("");

  const visibleProducts = getFilteredProducts();
  preview.list.innerHTML = visibleProducts.length
    ? visibleProducts
        .map((item) => {
          return `
        <article class="menu-item" data-id="${item.id}">
            ${productImage(item)}
            <div>
            <strong>${escapeHtml(item.name)}</strong>
            <p>${escapeHtml(item.description || item.category)}</p>
          </div>
          <div class="menu-action">
            <div class="menu-action-wrapper">
              <button class="choose-btn" type="button">${productPriceHtml(item)}</button>
            </div>
          </div>
        </article>
      `;
        })
        .join("")
    : '<div class="menu-preview-empty">Nenhum produto ativo no cardápio.</div>';

  syncOrderCapacityDots();
};

const syncFromFields = () => {
  if (menuLoadFailed) return;

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
    showAllProducts: fields.showAllProducts?.checked ?? true,
    selectedCategories,
  };
  render();
  window.clearTimeout(saveSettingsTimer);
  saveSettingsTimer = window.setTimeout(() => {
    saveMenuSettingsRemote(settings).catch(() => {
      showToast("Nao foi possivel salvar as alteracoes do cardapio.", { type: "error" });
    });
  }, 450);
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
              : key === "gradientAngle"
                ? settings.gradientAngle ?? 135
                : key === "gradientStart"
                  ? settings.gradientStart || settings.primaryColor || "#0f766e"
                  : key === "gradientEnd"
                    ? settings.gradientEnd || "#1f2a24"
              : settings[key] || "";
  }
  field.addEventListener("input", syncFromFields);
  field.addEventListener("change", syncFromFields);
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
        .then(() => showToast(`QR da mesa ${tableNumber} pronto.`))
        .catch((error) => showToast(error.message || "Não foi possível criar o QR da mesa.", { type: "error" }));
    });
    return button;
  })
);

fields.showAllProducts?.addEventListener("change", () => {
  syncCategoryField();
  syncFromFields();
});

fields.categoryList?.addEventListener("change", syncFromFields);

document.querySelectorAll(".menu-theme-card").forEach((button) => {
  button.addEventListener("click", () => {
    selectedTheme = button.dataset.theme || "default";
    const theme = themeMap[selectedTheme] || themeMap.default;
    fields.primaryColor.value = theme.accent;
    if (fields.gradientStart) fields.gradientStart.value = theme.gradientStart;
    if (fields.gradientEnd) fields.gradientEnd.value = theme.gradientEnd;
    if (fields.gradientAngle) fields.gradientAngle.value = String(theme.gradientAngle);
    document.querySelectorAll(".menu-theme-card").forEach((item) => {
      item.classList.toggle("is-active", item === button);
    });
    syncFromFields();
  });
});

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
    .then(() => showToast("QR Code atualizado."))
    .catch((error) => showToast(error.message || "Não foi possível atualizar o QR Code.", { type: "error" }));
});

qrCodeTable?.addEventListener("change", () => {
  renderQrCode().catch(() => {});
});

qrCodeOpenPage?.addEventListener("click", () => {
  renderQrCode()
    .then(() => window.open(getCustomerMenuUrl(), "_blank", "noopener,noreferrer"))
    .catch((error) => showToast(error.message || "Não foi possível abrir a página.", { type: "error" }));
});
copyQrCodeLink?.addEventListener("click", async () => {
  try {
    await renderQrCode();
    const value = qrCodeLink?.value || getCustomerMenuUrl();
    await navigator.clipboard.writeText(value);
    showToast("Link copiado.");
  } catch {
    qrCodeLink?.focus();
    qrCodeLink?.select();
    showToast("Copie o link manualmente.", { type: "error" });
  }
});
downloadQrPng?.addEventListener("click", async () => {
  try {
    await downloadQrAsImage("png");
  } catch (error) {
    showToast(error.message || "Não foi possível baixar o QR em PNG.", { type: "error" });
  }
});
downloadQrJpeg?.addEventListener("click", async () => {
  try {
    await downloadQrAsImage("jpeg");
  } catch (error) {
    showToast(error.message || "Não foi possível baixar o QR em JPEG.", { type: "error" });
  }
});
downloadQrPdf?.addEventListener("click", async () => {
  try {
    await downloadQrAsPdf();
  } catch (error) {
    showToast(error.message || "Não foi possível baixar o QR em PDF.", { type: "error" });
  }
});

(async () => {
  try {
    await initAppShell({ activeNav: "menu" });
    products = (await loadProducts()).map(normalizeProduct);
    categoryNames = await loadCategories();
    restaurantTables = await loadRestaurantTablesRemote();
  } catch (error) {
    renderMenuLoadError(error.message || "Não foi possível carregar o cardápio pela API.");
    showToast(error.message || "Não foi possível carregar o cardápio.", { type: "error" });
    return;
  }

  if (!Array.isArray(settings.selectedCategories)) {
    settings.selectedCategories = [];
  }
  if (typeof settings.showAllProducts !== "boolean") {
    settings.showAllProducts = true;
  }
  if (fields.gradientStart && !settings.gradientStart) settings.gradientStart = settings.primaryColor || "#0f766e";
  if (fields.gradientEnd && !settings.gradientEnd) settings.gradientEnd = "#1f2a24";
  if (fields.gradientAngle && settings.gradientAngle == null) settings.gradientAngle = 140;
  if (fields.gradientStart) fields.gradientStart.value = settings.gradientStart;
  if (fields.gradientEnd) fields.gradientEnd.value = settings.gradientEnd;
  if (fields.gradientAngle) fields.gradientAngle.value = String(settings.gradientAngle);
  syncCategoryField();
  selectedTheme = Object.entries(themeMap).find(([, theme]) => theme.accent === settings.primaryColor)?.[0] || "default";
  document.querySelectorAll(".menu-theme-card").forEach((item) => {
    item.classList.toggle("is-active", item.dataset.theme === selectedTheme);
  });
  render();
  renderQrCode().catch(() => {});
})();
