import { apiRequest } from "../../../shared/api/client.js";
import { getSession } from "../../../shared/data/storage.js";
import { escapeHtml } from "../../../shared/utils/utils.js";
import { initAppShell } from "../../../shared/ui/ui.js";

const businessId = getSession()?.businessId;
const providersRoot = document.getElementById("integrationProviders");
const message = document.getElementById("integrationMessage");
const modal = document.getElementById("integrationModal");
const modalTitle = document.getElementById("integrationModalTitle");
const modalForm = document.getElementById("integrationModalForm");

const PROVIDERS = [
  { id: "ifood", name: "iFood", icon: "assets/ifood.webp" },
  { id: "99food", name: "99Food", icon: "assets/99food.webp" },
  { id: "keeta", name: "Keeta", icon: "assets/keeta.webp" },
];
const PROVIDER_IDS = new Set(PROVIDERS.map((provider) => provider.id));

let connections = new Map();
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
  if (!connection) return "idle";
  if (polling?.last_error) return "error";
  if (polling?.enabled && polling?.has_token) return "online";
  return "pending";
};

const renderProviders = () => {
  providersRoot.setAttribute("aria-busy", "false");
  providersRoot.innerHTML = PROVIDERS.map((provider) => {
    const connection = connections.get(provider.id);
    const polling = connection?.polling;
    const state = statusOf(connection, polling);
    const label = { idle: "Conectar", pending: "Configurar", online: "Conectado", error: "Verificar" }[state];
    return `
      <article class="provider-card provider-card--${state}" data-provider="${provider.id}">
        <img class="provider-card__mark" src="${provider.icon}" alt="" aria-hidden="true" />
        <div class="provider-card__name">${escapeHtml(provider.name)}</div>
        <div class="provider-card__state" data-state aria-label="${label}">
          <span class="provider-card__dot"></span>
        </div>
        <div class="provider-card__actions">
          <button class="provider-btn provider-btn--primary" type="button" data-provider-connect="${provider.id}">${label}</button>
          <button class="provider-btn provider-btn--sync" type="button" data-provider-sync="${provider.id}" ${state !== "online" ? "disabled" : ""} aria-label="Sincronizar">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M20 7v5h-5M4 17v-5h5m10.4 2A7 7 0 0 1 6 18l-2-2m14-8-2 2M4 9a7 7 0 0 1 13.4-4"/></svg>
          </button>
        </div>
      </article>
    `;
  }).join("");
};

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

const openModal = (providerId) => {
  activeProvider = connections.get(providerId);
  modalTitle.textContent = providerName(providerId);
  modalForm.querySelector("input[name='poll_url']").value = activeProvider?.polling?.poll_url || "";
  modalForm.querySelector("input[name='access_token']").value = "";
  modal.hidden = false;
  document.body.classList.add("modal-open");
  modalForm.querySelector("input[name='poll_url']").focus();
};

const closeModal = () => {
  modal.hidden = true;
  document.body.classList.remove("modal-open");
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
  if (!activeProvider) return;
  const pollUrl = modalForm.querySelector("input[name='poll_url']").value.trim();
  const accessToken = modalForm.querySelector("input[name='access_token']").value.trim();
  if (!pollUrl || !accessToken) return;

  const button = modalForm.querySelector("button[type='submit']");
  button.disabled = true;
  showMessage("");
  try {
    if (!connections.has(activeProvider.provider)) {
      const created = await apiRequest(`/businesses/${businessId}/integrations`, {
        method: "POST",
        body: { provider: activeProvider.provider, display_name: providerName(activeProvider.provider) },
      });
      activeProvider = { ...created.connection };
      connections.set(activeProvider.provider, activeProvider);
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

providersRoot.addEventListener("click", async (event) => {
  const connectButton = event.target.closest("[data-provider-connect]");
  if (connectButton) {
    openModal(connectButton.dataset.providerConnect);
    return;
  }
  const syncButton = event.target.closest("[data-provider-sync]");
  if (!syncButton || syncButton.disabled) return;
  const connection = connections.get(syncButton.dataset.providerSync);
  if (!connection || !connection.polling?.has_token) {
    showMessage("Configure o token primeiro", "error");
    return;
  }

  syncButton.disabled = true;
  showMessage("");
  try {
    const data = await apiRequest(`/businesses/${businessId}/integrations/${connection.id}/poll-now`, { method: "POST" });
    const imported = Number(data.result?.imported || 0);
    showMessage(imported ? `${imported} novo(s)` : "Sem novos pedidos");
    await load();
  } catch {
    showMessage("Não foi possível sincronizar", "error");
  } finally {
    syncButton.disabled = false;
  }
});

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
