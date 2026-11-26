import { apiRequest } from "../../../shared/api/client.js";
import { getSession } from "../../../shared/data/storage.js";
import { escapeHtml } from "../../../shared/utils/utils.js";
import { openExternalUrl } from "../../../shared/utils/open-external.js";
import { initAppShell } from "../../../shared/ui/ui.js";

const businessId = getSession()?.businessId;
const providersRoot = document.getElementById("integrationProviders");
const searchInput = document.getElementById("integrationSearch");
const message = document.getElementById("integrationMessage");
const modal = document.getElementById("integrationModal");
const modalTitle = document.getElementById("integrationModalTitle");
const modalForm = document.getElementById("integrationModalForm");
const modalTokenButton = document.getElementById("integrationModalTokenButton");

const PROVIDERS = [
  { id: "ifood", name: "iFood", icon: "assets/ifood.webp", tokenUrl: "https://www.ifood.com.br/" },
  { id: "99food", name: "99Food", icon: "assets/99food.webp", tokenUrl: "https://99app.com/99food/" },
  { id: "keeta", name: "Keeta", icon: "assets/keeta.webp", tokenUrl: "https://www.keeta-global.com/" },
];
const PROVIDER_IDS = new Set(PROVIDERS.map((provider) => provider.id));

let connections = new Map();
let activeProviderId = null;
let activeProvider = null;
let appShellReady = false;
let feedbackTimer = 0;

const showMessage = (text, type = "success") => {
  clearTimeout(feedbackTimer);
  message.textContent = text;
  message.hidden = !text;
  message.classList.toggle("is-success", type === "success");
  message.classList.toggle("is-error", type === "error");
  if (text) feedbackTimer = setTimeout(() => { message.hidden = true; }, 3500);
};

const providerName = (id) => PROVIDERS.find((provider) => provider.id === id)?.name || id;

const statusOf = (connection, polling) => {
  if (!connection || !polling?.has_token) return "idle";
  if (!navigator.onLine || polling?.last_error) return "error";
  if (polling?.enabled) return "online";
  return "idle";
};

const renderProviders = () => {
  providersRoot.setAttribute("aria-busy", "false");
  const term = searchInput.value.trim().toLocaleLowerCase("pt-BR");
  const visible = PROVIDERS.filter((provider) =>
    provider.name.toLocaleLowerCase("pt-BR").includes(term)
  );
  if (!visible.length) {
    providersRoot.innerHTML = `<p class="operation-empty" role="status">Nenhuma integração encontrada</p>`;
    return;
  }
  providersRoot.innerHTML = visible.map((provider) => {
    const connection = connections.get(provider.id);
    const polling = connection?.polling;
    const state = statusOf(connection, polling);
    const label = { idle: "Conectar", online: "Conectado", error: "Verificar" }[state];
    return `
      <article class="provider-card provider-card--${state}" data-provider="${provider.id}">
        <img class="provider-card__mark" src="${provider.icon}" alt="" aria-hidden="true" />
        <div class="provider-card__name">${escapeHtml(provider.name)}</div>
        <div class="provider-card__state" data-state aria-label="${label}">
          <span class="provider-card__dot"></span>
        </div>
        <div class="provider-card__actions">
          <button class="provider-btn provider-btn--primary" type="button" data-provider-connect="${provider.id}">${label}</button>
        </div>
      </article>
    `;
  }).join("");
};

searchInput.addEventListener("input", renderProviders);

const loadPolling = async (connection) => {
  try {
    const data = await apiRequest(`/businesses/${businessId}/integrations/${connection.id}/polling-credentials`);
    return data.polling;
  } catch {
    return null;
  }
};

const load = async () => {
  providersRoot.setAttribute("aria-busy", "true");
  try {
    const data = await apiRequest(`/businesses/${businessId}/integrations`);
    const list = (Array.isArray(data.connections) ? data.connections : []).filter((connection) => PROVIDER_IDS.has(connection.provider));
    const entries = await Promise.all(list.map(async (connection) => [connection.provider, { ...connection, polling: await loadPolling(connection) }]));
    connections = new Map(entries);
    renderProviders();
    return true;
  } catch {
    providersRoot.innerHTML = `<p class="operation-empty" role="alert">Não foi possível carregar</p>`;
    providersRoot.setAttribute("aria-busy", "false");
    return false;
  }
};

modalTokenButton.addEventListener("click", () => {
  const provider = PROVIDERS.find((item) => item.id === activeProviderId);
  if (!provider?.tokenUrl) return;
  void openExternalUrl(provider.tokenUrl);
});

const openModal = (providerId) => {
  activeProviderId = providerId;
  activeProvider = connections.get(providerId) || null;
  const provider = PROVIDERS.find((item) => item.id === providerId);
  modalTitle.textContent = providerName(providerId);
  modalTokenButton.textContent = `Obtenha o Token na ${provider?.name || providerName(providerId)}`;
  modalTokenButton.hidden = !provider?.tokenUrl;
  modalForm.querySelector("input[name='access_token']").value = "";
  modal.hidden = false;
  document.body.classList.add("modal-open");
  modalForm.querySelector("input[name='access_token']").focus();
};

const closeModal = () => {
  modal.hidden = true;
  document.body.classList.remove("modal-open");
  activeProviderId = null;
  activeProvider = null;
};

modal.addEventListener("click", (event) => {
  if (event.target.closest("[data-modal-close]")) closeModal();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !modal.hidden) closeModal();
});

modalForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!activeProviderId) return;
  const provider = PROVIDERS.find((item) => item.id === activeProviderId);
  const pollUrl = provider?.tokenUrl || "";
  const accessToken = modalForm.querySelector("input[name='access_token']").value.trim();
  if (!pollUrl || !accessToken) return;

  const button = modalForm.querySelector("button[type='submit']");
  button.disabled = true;
  showMessage("");
  try {
    if (!connections.has(activeProviderId)) {
      const created = await apiRequest(`/businesses/${businessId}/integrations`, {
        method: "POST",
        body: { provider: activeProviderId, display_name: providerName(activeProviderId) },
      });
      activeProvider = { ...created.connection };
      connections.set(activeProviderId, activeProvider);
    }
    await apiRequest(`/businesses/${businessId}/integrations/${activeProvider.id}/polling-credentials`, {
      method: "PUT",
      body: { poll_url: pollUrl, access_token: accessToken, token_type: "bearer" },
    });
    closeModal();
    showMessage("Conectado");
    await load();
  } catch {
    showMessage("Não foi possível salvar", "error");
  } finally {
    button.disabled = false;
  }
});

providersRoot.addEventListener("click", (event) => {
  const connectButton = event.target.closest("[data-provider-connect]");
  if (connectButton) openModal(connectButton.dataset.providerConnect);
});

window.addEventListener("online", () => { void load(); });
window.addEventListener("offline", renderProviders);

const start = async () => {
  try {
    if (!appShellReady) {
      await initAppShell({ activeNav: "integrations" });
      appShellReady = true;
    }
    await load();
  } catch {
    providersRoot.innerHTML = `<p class="operation-empty" role="alert">Não foi possível carregar</p>`;
  }
};

void start();
