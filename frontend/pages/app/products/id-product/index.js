const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");

const formatProductPrice = (value) => {
  const normalized = String(value ?? "").replace(/[^0-9,.-]/g, "").replace(",", ".");
  const amount = Number(normalized) || 0;
  return amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
};

export const initProductDetailsPanel = ({ onToggleStatus } = {}) => {
  const backdrop = document.createElement("button");
  backdrop.className = "id-product-backdrop";
  backdrop.type = "button";
  backdrop.hidden = true;
  backdrop.setAttribute("aria-label", "Fechar detalhes do produto");

  const panel = document.createElement("aside");
  panel.className = "id-product-panel";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", "Detalhes do produto");

  document.body.append(backdrop, panel);

  let currentProduct = null;

  const close = () => {
    panel.classList.remove("is-open");
    backdrop.classList.remove("is-open");
    document.body.classList.remove("id-product-open");
    setTimeout(() => {
      panel.hidden = true;
      backdrop.hidden = true;
    }, 180);
  };

  const render = (product) => {
    if (!product) return;
    currentProduct = product;
    const name = escapeHtml(product.name || "Produto sem nome");
    const image = product.image
      ? `<img class="id-product-panel__image" src="${escapeHtml(product.image)}" alt="${name}" />`
      : `<div class="id-product-panel__image id-product-panel__image--empty" aria-hidden="true">${name.slice(0, 2).toUpperCase()}</div>`;

    panel.innerHTML = `
      <div class="id-product-panel__handle" aria-hidden="true"></div>
      <header class="id-product-panel__header">
        <div>
          <p>Produto</p>
          <h2>${name}</h2>
        </div>
        <button class="id-product-panel__close" type="button" data-id-product-close aria-label="Fechar">×</button>
      </header>
      <div class="id-product-panel__body">
        ${image}
        <div class="id-product-panel__price">${formatProductPrice(product.price)}</div>
        <p class="id-product-panel__description">${escapeHtml(product.description || "Sem descrição cadastrada.")}</p>
        <dl class="id-product-panel__data">
          <div><dt>ID</dt><dd>${escapeHtml(product.id || "-")}</dd></div>
          <div><dt>Categoria</dt><dd>${escapeHtml(product.category || "Não informada")}</dd></div>
          <div><dt>Status</dt><dd><span class="id-product-panel__status ${product.active ? "is-active" : "is-inactive"}">${product.active ? "Ativo" : "Inativo"}</span></dd></div>
        </dl>
      </div>
      <footer class="id-product-panel__actions">
        <button class="btn ${product.active ? "btn--secondary" : "btn--primary"}" type="button" data-id-product-toggle="${escapeHtml(product.id)}">
          ${product.active ? "Desativar produto" : "Ativar produto"}
        </button>
        <button class="btn btn--secondary" type="button" data-id-product-close>Fechar</button>
      </footer>
    `;
  };

  const open = (product) => {
    render(product);
    backdrop.hidden = false;
    panel.hidden = false;
    document.body.classList.add("id-product-open");
    requestAnimationFrame(() => {
      backdrop.classList.add("is-open");
      panel.classList.add("is-open");
    });
  };

  backdrop.addEventListener("click", close);
  panel.addEventListener("click", async (event) => {
    if (event.target.closest("[data-id-product-close]")) {
      close();
      return;
    }

    const toggle = event.target.closest("[data-id-product-toggle]");
    if (!toggle || !currentProduct || !onToggleStatus) return;
    toggle.disabled = true;
    const updated = await onToggleStatus(currentProduct.id);
    if (updated) render(updated);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.hidden) close();
  });

  return { close, open, refresh: render };
};
