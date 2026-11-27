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
const modalHint = document.querySelector(".integration-modal__hint");
const modalUrlLabel = document.getElementById("integrationUrlLabel");
const modalUrlInput = modalForm.querySelector("input[name='poll_url']");

const PROVIDERS = [
  { id: "ifood", name: "iFood", icon: "assets/ifood.webp", tokenUrl: "https://www.ifood.com.br/" },
  { id: "99food", name: "99Food", icon: "assets/99food.webp", tokenUrl: "https://99app.com/99food/" },
  { id: "keeta", name: "Keeta", icon: "assets/keeta.webp", tokenUrl: "https://www.keeta-global.com/" },
];

const TERMINAL_PROVIDERS = [
  ["stone", "Stone"], ["pagbank", "PagBank"], ["getnet", "Getnet"], ["cielo", "Cielo"],
  ["rede", "Rede"], ["sicredi", "Sicredi"], ["sicoob", "Sicoob"], ["generic", "Genérico"],
];
const GATEWAY_PROVIDERS = [
  ["mercadopago", "Mercado Pago"], ["pagbank", "PagBank"], ["asaas", "Asaas"],
  ["stripe", "Stripe"], ["pagarme", "Pagar.me"],
];

let connections = new Map();
let activeProviderId = null;
let activeProvider = null;
let appShellReady = false;
let feedbackTimer = 0;
let terminals = [];
let gateways = [];
let aiConnection = null;
let aiStatus = null;

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
  const cards = visible.map((provider) => {
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

  const paymentVisible = "pagamentos".includes(term) || "máquina de cartão".includes(term) || "cartão".includes(term);
  const activeCount = terminals.filter((t) => t.active).length + gateways.filter((g) => g.active).length;
  const paymentState = activeCount ? "online" : "idle";
  const paymentLabel = activeCount ? "Configurado" : "Conectar";
  const paymentCard = paymentVisible ? `
    <article class="provider-card provider-card--${paymentState}" data-provider="payment">
      <img class="provider-card__mark" src="assets/card.webp" alt="" aria-hidden="true" />
      <div class="provider-card__name">Pagamentos</div>
      <div class="provider-card__state" data-state aria-label="${paymentLabel}"><span class="provider-card__dot"></span></div>
      <div class="provider-card__actions">
        <button class="provider-btn provider-btn--primary" type="button" data-payment-open>${paymentLabel}</button>
      </div>
    </article>
  ` : "";

  const aiVisible = "inteligência artificial".includes(term) || "modelos de ia".includes(term) || "ia".includes(term) || "modelo".includes(term);
  const aiState = aiStatus?.has_key ? (aiStatus.last_error ? "error" : "online") : "idle";
  const aiLabel = aiStatus?.has_key ? "Configurado" : "Conectar";
  const aiCard = aiVisible ? `
    <article class="provider-card provider-card--${aiState}" data-provider="ai_model">
      <img class="provider-card__mark" src="assets/robot.webp" alt="" aria-hidden="true" />
      <div class="provider-card__name">Modelos de IA</div>
      <div class="provider-card__state" data-state aria-label="${aiLabel}"><span class="provider-card__dot"></span></div>
      <div class="provider-card__actions">
        <button class="provider-btn provider-btn--primary" type="button" data-ai-open>${aiLabel}</button>
      </div>
    </article>
  ` : "";

  providersRoot.innerHTML = cards + paymentCard + aiCard;
  if (!cards && !paymentCard && !aiCard) {
    providersRoot.innerHTML = `<p class="operation-empty" role="status">Nenhuma integração encontrada</p>`;
  }
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

const loadPayments = async () => {
  try {
    const [terminalData, gatewayData] = await Promise.all([
      apiRequest(`/businesses/${businessId}/payment-terminals`),
      apiRequest(`/businesses/${businessId}/payment-gateways`),
    ]);
    terminals = Array.isArray(terminalData.terminals) ? terminalData.terminals : [];
    gateways = Array.isArray(gatewayData.gateways) ? gatewayData.gateways : [];
  } catch {
    terminals = [];
    gateways = [];
  }
};

const loadAiStatus = async () => {
  if (!aiConnection?.id) return null;
  try {
    const data = await apiRequest(`/businesses/${businessId}/integrations/${aiConnection.id}/ai-status`);
    return data.ai;
  } catch {
    return null;
  }
};

const load = async () => {
  providersRoot.setAttribute("aria-busy", "true");
  try {
    const data = await apiRequest(`/businesses/${businessId}/integrations`);
    const all = Array.isArray(data.connections) ? data.connections : [];
    const list = all.filter((connection) => ["ifood", "99food", "keeta"].includes(connection.provider));
    aiConnection = all.find((connection) => connection.provider === "ai_model") || null;
    const entries = await Promise.all(list.map(async (connection) => [connection.provider, { ...connection, polling: await loadPolling(connection) }]));
    connections = new Map(entries);
    aiStatus = await loadAiStatus();
    await loadPayments();
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
  modalHint.textContent = provider?.tokenUrl
    ? "Obtenha o token de integração no site do aplicativo e cole abaixo"
    : "Informe a URL HTTPS de consulta e o token de acesso fornecidos pelo provedor";
  modalUrlLabel.hidden = Boolean(provider?.tokenUrl);
  modalUrlInput.required = !provider?.tokenUrl;
  modalUrlInput.value = activeProvider?.polling?.poll_url || "";
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
  const pollUrl = provider?.tokenUrl || modalUrlInput.value.trim();
  const accessToken = modalForm.querySelector("input[name='access_token']").value.trim();
  if (!pollUrl || !accessToken) {
    showMessage("Informe a URL de consulta e o token", "error");
    return;
  }

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

const paymentModal = document.getElementById("paymentModal");
const paymentTabs = document.querySelectorAll("[data-payment-tab]");
const paymentPanels = document.querySelectorAll("[data-payment-panel]");
const terminalForm = document.getElementById("terminalForm");
const gatewayForm = document.getElementById("gatewayForm");
const terminalList = document.getElementById("integrationTerminalList");
const gatewayList = document.getElementById("integrationGatewayList");

const options = (items) => items.map(([value, label]) => `<option value="${value}">${escapeHtml(label)}</option>`).join("");

const fillPaymentForms = () => {
  const terminalProvider = terminalForm.querySelector("select[name='provider']");
  const gatewayProvider = gatewayForm.querySelector("select[name='provider']");
  if (!terminalProvider.dataset.filled) {
    terminalProvider.innerHTML = options(TERMINAL_PROVIDERS);
    terminalProvider.dataset.filled = "1";
  }
  if (!gatewayProvider.dataset.filled) {
    gatewayProvider.innerHTML = options(GATEWAY_PROVIDERS);
    gatewayProvider.dataset.filled = "1";
  }
};

const renderPaymentLists = () => {
  terminalList.innerHTML = terminals.length
    ? terminals.map((item) => `
        <article class="integration-detail-item">
          <div><strong>${escapeHtml(item.display_name)}</strong><span>${escapeHtml(item.provider)} ${escapeHtml(item.endpoint_url)}</span></div>
          <span>${item.active ? "Ativo" : "Inativo"}</span>
          <button class="btn btn--secondary" type="button" data-delete-terminal="${escapeHtml(item.id)}">Remover</button>
        </article>`).join("")
    : `<p class="operation-empty">Nenhuma máquina cadastrada</p>`;
  gatewayList.innerHTML = gateways.length
    ? gateways.map((item) => `
        <article class="integration-detail-item">
          <div><strong>${escapeHtml(item.display_name)}</strong><span>${escapeHtml(item.provider)}</span></div>
          <span>${item.active ? "Ativo" : "Inativo"}</span>
          <button class="btn btn--secondary" type="button" data-delete-gateway="${escapeHtml(item.id)}">Remover</button>
        </article>`).join("")
    : `<p class="operation-empty">Nenhum gateway cadastrado</p>`;
};

const setPaymentTab = (tab) => {
  paymentTabs.forEach((button) => button.classList.toggle("is-active", button.dataset.paymentTab === tab));
  paymentPanels.forEach((panel) => { panel.hidden = panel.dataset.paymentPanel !== tab; });
};

const openPaymentModal = () => {
  fillPaymentForms();
  setPaymentTab("terminal");
  renderPaymentLists();
  paymentModal.hidden = false;
  document.body.classList.add("modal-open");
  showMessage("");
};

const closePaymentModal = () => {
  paymentModal.hidden = true;
  document.body.classList.remove("modal-open");
};

paymentModal.addEventListener("click", async (event) => {
  if (event.target.closest("[data-modal-close]")) return closePaymentModal();
  const tab = event.target.closest("[data-payment-tab]");
  if (tab) return setPaymentTab(tab.dataset.paymentTab);

  const terminalId = event.target.closest("[data-delete-terminal]")?.dataset.deleteTerminal;
  const gatewayId = event.target.closest("[data-delete-gateway]")?.dataset.deleteGateway;
  if (!terminalId && !gatewayId) return;
  showMessage("");
  try {
    if (terminalId) await apiRequest(`/businesses/${businessId}/payment-terminals/${terminalId}`, { method: "DELETE" });
    if (gatewayId) await apiRequest(`/businesses/${businessId}/payment-gateways/${gatewayId}`, { method: "DELETE" });
    showMessage("Integração removida");
    await loadPayments();
    renderPaymentLists();
    renderProviders();
  } catch {
    showMessage("Não foi possível remover", "error");
  }
});

const aiModal = document.getElementById("aiModal");

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !paymentModal.hidden) closePaymentModal();
  if (event.key === "Escape" && !aiModal.hidden) closeAiModal();
});


const aiForm = document.getElementById("aiForm");
const aiKeyForm = document.getElementById("aiKeyForm");
const aiTestButton = document.getElementById("aiTestButton");
const aiResult = document.getElementById("aiResult");
const aiChatForm = document.getElementById("aiChatForm");

const setAiTab = (tab) => {
  document.querySelectorAll("[data-ai-tab]").forEach((button) => button.classList.toggle("is-active", button.dataset.aiTab === tab));
  document.querySelectorAll("[data-ai-panel]").forEach((panel) => { panel.hidden = panel.dataset.aiPanel !== tab; });
};

const openAiModal = () => {
  const settings = aiConnection?.settings ? (typeof aiConnection.settings === "string" ? JSON.parse(aiConnection.settings) : aiConnection.settings) : {};
  aiForm.querySelector("input[name='display_name']").value = aiConnection?.display_name || "";
  aiForm.querySelector("input[name='base_url']").value = aiStatus?.base_url || settings.base_url || "";
  aiForm.querySelector("input[name='model']").value = aiStatus?.model || settings.model || "";
  aiForm.querySelector("input[name='temperature']").value = settings.temperature ?? 0.3;
  aiForm.querySelector("input[name='max_tokens']").value = settings.max_tokens ?? 600;
  aiKeyForm.querySelector("input[name='api_key']").value = "";
  aiResult.textContent = "";
  setAiTab("config");
  aiModal.hidden = false;
  document.body.classList.add("modal-open");
  showMessage("");
};

const closeAiModal = () => {
  aiModal.hidden = true;
  document.body.classList.remove("modal-open");
};

aiModal.addEventListener("click", (event) => {
  if (event.target.closest("[data-modal-close]")) return closeAiModal();
  const tab = event.target.closest("[data-ai-tab]");
  if (tab) setAiTab(tab.dataset.aiTab);
});

aiForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showMessage("");
  const data = Object.fromEntries(new FormData(aiForm).entries());
  const button = aiForm.querySelector("button[type='submit']");
  button.disabled = true;
  try {
    if (!aiConnection) {
      const created = await apiRequest(`/businesses/${businessId}/integrations`, {
        method: "POST",
        body: { provider: "ai_model", display_name: data.display_name || "Modelo de IA", settings: { base_url: data.base_url, model: data.model, temperature: Number(data.temperature) || 0.3, max_tokens: Number(data.max_tokens) || 600 } },
      });
      aiConnection = created.connection;
    } else {
      await apiRequest(`/businesses/${businessId}/integrations/${aiConnection.id}`, {
        method: "PATCH",
        body: { settings: { base_url: data.base_url, model: data.model, temperature: Number(data.temperature) || 0.3, max_tokens: Number(data.max_tokens) || 600 } },
      });
    }
    showMessage("Configuração salva");
    await load();
    setAiTab("key");
  } catch (error) {
    showMessage(error.message || "Não foi possível salvar", "error");
  } finally {
    button.disabled = false;
  }
});

aiKeyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showMessage("");
  if (!aiConnection) return showMessage("Salve a configuração primeiro", "error");
  const apiKey = aiKeyForm.querySelector("input[name='api_key']").value.trim();
  const button = aiKeyForm.querySelector("button[type='submit']");
  button.disabled = true;
  try {
    await apiRequest(`/businesses/${businessId}/integrations/${aiConnection.id}/ai-credentials`, { method: "PUT", body: { api_key: apiKey } });
    aiKeyForm.reset();
    showMessage("Chave salva");
    await load();
  } catch (error) {
    showMessage(error.message || "Não foi possível salvar a chave", "error");
  } finally {
    button.disabled = false;
  }
});

aiTestButton.addEventListener("click", async () => {
  if (!aiConnection) return showMessage("Salve a configuração primeiro", "error");
  aiTestButton.disabled = true;
  showMessage("");
  try {
    const data = await apiRequest(`/businesses/${businessId}/integrations/${aiConnection.id}/ai-test`, { method: "POST" });
    showMessage(`Conectado ${data.models.length} modelo(s) disponível(is)`);
    await load();
  } catch (error) {
    showMessage(error.message || "Não foi possível conectar", "error");
  } finally {
    aiTestButton.disabled = false;
  }
});

aiChatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!aiConnection) return showMessage("Salve a configuração primeiro", "error");
  const prompt = aiChatForm.querySelector("textarea[name='prompt']").value.trim();
  if (!prompt) return;
  aiResult.textContent = "Gerando";
  const button = aiChatForm.querySelector("button[type='submit']");
  button.disabled = true;
  try {
    const data = await apiRequest(`/businesses/${businessId}/integrations/${aiConnection.id}/ai-chat`, {
      method: "POST",
      body: { prompt, feature: "teste" },
    });
    aiResult.textContent = data.text;
  } catch (error) {
    aiResult.textContent = "";
    showMessage(error.message || "Não foi possível gerar", "error");
  } finally {
    button.disabled = false;
  }
});

terminalForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showMessage("");
  const data = Object.fromEntries(new FormData(terminalForm).entries());
  data.active = data.active === "on";
  const button = terminalForm.querySelector("button[type='submit']");
  button.disabled = true;
  try {
    await apiRequest(`/businesses/${businessId}/payment-terminals`, { method: "POST", body: data });
    terminalForm.reset();
    fillPaymentForms();
    showMessage("Máquina adicionada");
    await loadPayments();
    renderPaymentLists();
    renderProviders();
  } catch (error) {
    showMessage(error.message || "Não foi possível adicionar a máquina", "error");
  } finally {
    button.disabled = false;
  }
});

gatewayForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showMessage("");
  const data = Object.fromEntries(new FormData(gatewayForm).entries());
  data.active = data.active === "on";
  const button = gatewayForm.querySelector("button[type='submit']");
  button.disabled = true;
  try {
    await apiRequest(`/businesses/${businessId}/payment-gateways`, { method: "POST", body: data });
    gatewayForm.reset();
    fillPaymentForms();
    showMessage("Gateway adicionado");
    await loadPayments();
    renderPaymentLists();
    renderProviders();
  } catch (error) {
    showMessage(error.message || "Não foi possível adicionar o gateway", "error");
  } finally {
    button.disabled = false;
  }
});

providersRoot.addEventListener("click", (event) => {
  const connectButton = event.target.closest("[data-provider-connect]");
  if (connectButton) openModal(connectButton.dataset.providerConnect);
  if (event.target.closest("[data-payment-open]")) openPaymentModal();
  if (event.target.closest("[data-ai-open]")) openAiModal();
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
