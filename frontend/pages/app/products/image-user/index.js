import { translate } from "../../../../shared/i18n/i18n.js";

const panelId = "imageUserPanel";
const backdropId = "imageUserBackdrop";
const MAX_IMAGE_FILE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 12_000;
const MAX_IMAGE_PIXELS = 40_000_000;
const supportedImageTypes = new Set(["image/png", "image/jpeg", "image/webp"]);

const createImage = (src) =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not decode image"));
    image.src = src;
  });

const ensurePanel = () => {
  let backdrop = document.getElementById(backdropId);
  let panel = document.getElementById(panelId);

  if (backdrop && panel) return { backdrop, panel };

  backdrop = document.createElement("div");
  backdrop.id = backdropId;
  backdrop.className = "image-user-backdrop";
  backdrop.hidden = true;

  panel = document.createElement("aside");
  panel.id = panelId;
  panel.className = "image-user-panel";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", translate("Editar imagem do produto"));
  panel.innerHTML = `
    <button type="button" class="image-user-panel__close" data-image-user-close aria-label="${translate("Fechar")}">×</button>
    <div class="image-user-panel__header">
      <p class="image-user-panel__eyebrow">${translate("Imagem")}</p>
      <h3>${translate("Imagem do produto")}</h3>
      <p class="image-user-panel__subtitle">${translate("Ajuste o enquadramento")}</p>
    </div>
    <div class="image-user-panel__body">
      <div class="image-user-panel__stage">
        <div class="image-user-panel__canvas" data-image-user-canvas>
          <img class="image-user-panel__image" data-image-user-image alt="${translate("Pré-visualização da imagem")}" draggable="false" />
          <div class="image-user-panel__empty" data-image-user-empty>
            ${translate("Selecione uma imagem")}
          </div>
        </div>
      </div>
      <div class="image-user-panel__controls">
        <label class="image-user-panel__field">
          <span>${translate("Imagem")}</span>
          <input type="file" accept="image/png,image/jpeg,image/webp" data-image-user-file />
        </label>
        <label class="image-user-panel__field">
          <span>${translate("Zoom")}</span>
          <input type="range" min="0.5" max="2" step="0.01" value="1" data-image-user-zoom />
        </label>
        <div class="image-user-panel__hint">${translate("Arraste para reposicionar")}</div>
        <p class="image-user-panel__hint" data-image-user-feedback role="status" hidden></p>
      </div>
      <div class="image-user-panel__actions">
        <button type="button" class="btn btn--secondary" data-image-user-cancel>${translate("Cancelar")}</button>
        <button type="button" class="btn btn--primary" data-image-user-save>${translate("Aplicar imagem")}</button>
      </div>
    </div>
  `;

  document.body.append(backdrop, panel);
  return { backdrop, panel };
};

export const initImageUserPanel = ({ onApply } = {}) => {
  const { backdrop, panel } = ensurePanel();
  const fileInput = panel.querySelector("[data-image-user-file]");
  const zoomInput = panel.querySelector("[data-image-user-zoom]");
  const canvas = panel.querySelector("[data-image-user-canvas]");
  const image = panel.querySelector("[data-image-user-image]");
  const emptyState = panel.querySelector("[data-image-user-empty]");
  const feedback = panel.querySelector("[data-image-user-feedback]");
  const closeButtons = panel.querySelectorAll("[data-image-user-close], [data-image-user-cancel]");
  const saveButton = panel.querySelector("[data-image-user-save]");

  let source = "";
  let state = {
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    dragging: false,
    startX: 0,
    startY: 0,
  };

  const render = () => {
    if (!source) {
      image.hidden = true;
      emptyState.hidden = false;
      return;
    }
    image.hidden = false;
    emptyState.hidden = true;
    image.style.transform = `translate(${state.offsetX}px, ${state.offsetY}px) scale(${state.scale})`;
  };

  const resetToFit = async (src) => {
    const loaded = await createImage(src);
    if (!loaded.naturalWidth || !loaded.naturalHeight || loaded.naturalWidth > MAX_IMAGE_DIMENSION || loaded.naturalHeight > MAX_IMAGE_DIMENSION || loaded.naturalWidth * loaded.naturalHeight > MAX_IMAGE_PIXELS) {
      throw new Error("Image dimensions exceed the supported limit");
    }
    source = src;
    image.src = src;
    const rect = canvas.getBoundingClientRect();
    const fit = Math.max(rect.width / loaded.naturalWidth, rect.height / loaded.naturalHeight);
    state = { scale: fit, offsetX: 0, offsetY: 0, dragging: false, startX: 0, startY: 0 };
    zoomInput.min = String(fit * 0.5);
    zoomInput.max = String(fit * 2);
    zoomInput.value = String(fit);
    const renderedW = loaded.naturalWidth * fit;
    const renderedH = loaded.naturalHeight * fit;
    state.offsetX = (rect.width - renderedW) / 2;
    state.offsetY = (rect.height - renderedH) / 2;
    render();
  };

  const open = async (src = "") => {
    backdrop.hidden = false;
    panel.hidden = false;
    requestAnimationFrame(() => {
      backdrop.classList.add("is-open");
      panel.classList.add("is-open");
    });
    document.body.classList.add("modal-open");
    if (src) {
      try { await resetToFit(src); }
      catch {
        source = "";
        image.removeAttribute("src");
        render();
        if (feedback) {
          feedback.textContent = translate("Não foi possível processar a imagem");
          feedback.hidden = false;
          feedback.setAttribute("role", "alert");
        }
      }
    } else render();
    fileInput?.focus();
  };

  const close = () => {
    backdrop.classList.remove("is-open");
    panel.classList.remove("is-open");
    document.body.classList.remove("modal-open");
    setTimeout(() => {
      backdrop.hidden = true;
      panel.hidden = true;
    }, 220);
  };

  const exportImage = async () => {
    if (!source) return "";
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = Math.round(rect.width * ratio);
    exportCanvas.height = Math.round(rect.height * ratio);
    const ctx = exportCanvas.getContext("2d");
    ctx.scale(ratio, ratio);
    const loaded = await createImage(source);
    ctx.drawImage(loaded, state.offsetX, state.offsetY, loaded.naturalWidth * state.scale, loaded.naturalHeight * state.scale);
    return exportCanvas.toDataURL("image/jpeg", 0.92);
  };

  fileInput?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!supportedImageTypes.has(file.type) || file.size > MAX_IMAGE_FILE_BYTES) {
      if (feedback) {
        feedback.textContent = translate("Selecione um arquivo PNG, JPEG ou WebP de até 8 MB");
        feedback.hidden = false;
        feedback.setAttribute("role", "alert");
      }
      fileInput.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        await resetToFit(String(reader.result || ""));
        if (feedback) {
          feedback.hidden = true;
          feedback.setAttribute("role", "status");
        }
      } catch {
        source = "";
        image.removeAttribute("src");
        render();
        if (feedback) {
          feedback.textContent = translate("Não foi possível processar a imagem");
          feedback.hidden = false;
          feedback.setAttribute("role", "alert");
        }
      } finally {
        fileInput.value = "";
      }
    };
    reader.onerror = () => {
      if (feedback) {
        feedback.textContent = translate("Não foi possível processar a imagem");
        feedback.hidden = false;
        feedback.setAttribute("role", "alert");
      }
      fileInput.value = "";
    };
    reader.readAsDataURL(file);
  });

  zoomInput?.addEventListener("input", (event) => {
    const newScale = parseFloat(event.target.value);
    const rect = canvas.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const ratio = newScale / state.scale;
    state.offsetX = centerX - (centerX - state.offsetX) * ratio;
    state.offsetY = centerY - (centerY - state.offsetY) * ratio;
    state.scale = newScale;
    render();
  });

  canvas?.addEventListener("pointerdown", (event) => {
    if (!source) return;
    canvas.setPointerCapture(event.pointerId);
    state.dragging = true;
    state.startX = event.clientX;
    state.startY = event.clientY;
  });

  canvas?.addEventListener("pointermove", (event) => {
    if (!state.dragging) return;
    state.offsetX += event.clientX - state.startX;
    state.offsetY += event.clientY - state.startY;
    state.startX = event.clientX;
    state.startY = event.clientY;
    render();
  });

  canvas?.addEventListener("pointerup", () => {
    state.dragging = false;
  });
  canvas?.addEventListener("pointercancel", () => {
    state.dragging = false;
  });

  saveButton?.addEventListener("click", async () => {
    const result = await exportImage();
    await onApply?.(result);
    close();
  });

  closeButtons.forEach((button) => button.addEventListener("click", close));
  backdrop.addEventListener("click", close);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.hidden) close();
  });

  return { open, close, exportImage };
};
