import { translate } from "../../../../shared/i18n/i18n.js";

const panelId = "categoryUserPanel";
const backdropId = "categoryUserBackdrop";

const ensurePanel = () => {
  let backdrop = document.getElementById(backdropId);
  let panel = document.getElementById(panelId);

  if (backdrop && panel) return { backdrop, panel };

  backdrop = document.createElement("div");
  backdrop.id = backdropId;
  backdrop.className = "category-user-backdrop";
  backdrop.hidden = true;

  panel = document.createElement("aside");
  panel.id = panelId;
  panel.className = "category-user-panel";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", translate("Create category"));
  panel.innerHTML = `
    <button type="button" class="category-user-panel__close" data-category-user-close aria-label="${translate("Close")}">×</button>
    <div class="category-user-panel__header">
      <h3>${translate("New category")}</h3>
    </div>
    <div class="category-user-panel__body">
      <label class="category-user-panel__field" for="categoryUserInput">
        <span>${translate("Category name")}</span>
        <input id="categoryUserInput" type="text" maxlength="120" placeholder="${translate("e.g Appetizers")}" />
      </label>
      <p class="category-user-panel__feedback" role="status" aria-live="polite" hidden></p>
      <div class="category-user-panel__actions">
        <button type="button" class="btn btn--secondary" data-category-user-cancel>${translate("Cancel")}</button>
        <button type="button" class="btn btn--primary" data-category-user-save>${translate("Add category")}</button>
      </div>
    </div>
  `;

  document.body.append(backdrop, panel);
  return { backdrop, panel };
};

export const initCategoryUserPanel = ({
  onCreate,
  onOpen,
  onClose,
} = {}) => {
  const { backdrop, panel } = ensurePanel();
  const input = panel.querySelector("#categoryUserInput");
  const closeButtons = panel.querySelectorAll("[data-category-user-close], [data-category-user-cancel]");
  const saveButton = panel.querySelector("[data-category-user-save]");
  const feedback = panel.querySelector(".category-user-panel__feedback");

  const open = () => {
    if (feedback) {
      feedback.hidden = true;
      feedback.textContent = "";
      feedback.removeAttribute("data-state");
    }
    backdrop.hidden = false;
    panel.hidden = false;
    requestAnimationFrame(() => {
      backdrop.classList.add("is-open");
      panel.classList.add("is-open");
    });
    document.body.classList.add("modal-open");
    input?.focus();
    onOpen?.();
  };

  const close = () => {
    backdrop.classList.remove("is-open");
    panel.classList.remove("is-open");
    document.body.classList.remove("modal-open");
    setTimeout(() => {
      backdrop.hidden = true;
      panel.hidden = true;
    }, 220);
    onClose?.();
  };

  const save = async () => {
    if (saveButton?.disabled) return;
    const value = String(input?.value || "").trim();
    if (!value) {
      feedback.textContent = translate("Enter the category name");
      feedback.dataset.state = "error";
      feedback.hidden = false;
      input?.focus();
      return;
    }
    saveButton.disabled = true;
    feedback.hidden = true;
    try {
      await onCreate?.(value);
      input.value = "";
      close();
    } catch {
      feedback.textContent = translate("Could not add the category Try again");
      feedback.dataset.state = "error";
      feedback.hidden = false;
    } finally {
      saveButton.disabled = false;
    }
  };

  saveButton?.addEventListener("click", save);

  input?.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    await save();
  });

  closeButtons.forEach((button) => button.addEventListener("click", close));
  backdrop.addEventListener("click", close);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.hidden) close();
  });

  return { open, close };
};
