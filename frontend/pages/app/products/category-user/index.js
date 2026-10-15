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
  panel.setAttribute("aria-label", "Criar categoria");
  panel.innerHTML = `
    <button type="button" class="category-user-panel__close" data-category-user-close aria-label="Fechar">×</button>
    <div class="category-user-panel__header">
      <p class="category-user-panel__eyebrow">Categoria</p>
      <h3>Nova categoria</h3>
      <p class="category-user-panel__subtitle">Disponível nos produtos</p>
    </div>
    <div class="category-user-panel__body">
      <label class="category-user-panel__field" for="categoryUserInput">
        <span>Nome da categoria</span>
        <input id="categoryUserInput" type="text" placeholder="Ex: Porções" />
      </label>
      <div class="category-user-panel__actions">
        <button type="button" class="btn btn--secondary" data-category-user-cancel>Cancelar</button>
        <button type="button" class="btn btn--primary" data-category-user-save>Adicionar categoria</button>
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

  const open = () => {
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

  saveButton?.addEventListener("click", async () => {
    const value = String(input?.value || "").trim();
    if (!value) return;
    await onCreate?.(value);
    input.value = "";
    close();
  });

  input?.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const value = String(input.value || "").trim();
    if (!value) return;
    await onCreate?.(value);
    input.value = "";
    close();
  });

  closeButtons.forEach((button) => button.addEventListener("click", close));
  backdrop.addEventListener("click", close);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.hidden) close();
  });

  return { open, close };
};
