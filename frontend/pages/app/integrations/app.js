import { apiRequest } from "../../../shared/api/client.js";
import { getSession } from "../../../shared/data/storage.js";
import { escapeHtml } from "../../../shared/utils/utils.js";
import { translate } from "../../../shared/i18n/i18n.js";
import { initAppShell } from "../../../shared/ui/ui.js";

const businessId = getSession()?.businessId;
const form = document.getElementById("integrationForm");
const list = document.getElementById("integrationList");
const message = document.getElementById("integrationMessage");
const createButton = form.querySelector("button[type='submit']");
let appShellReady = false;

const providerLabels = {
  ifood: "iFood",
  "99food": "99Food",
  keeta: "Keeta",
  delivery_logistics: "Logística",
  payment: "Pagamento",
};
const statusLabels = {
  disconnected: "Desconectada",
  pending: "Credenciais salvas · aguardando teste",
  connected: "Conectada",
  error: "Falha na conexão",
  disabled: "Desativada",
};

const userFacingError = (error) => {
  const raw = error?.message || "Não foi possível concluir a operação";
  if (raw.includes("FOOD_SYSTEM_SECRET_KEY")) {
    return "O armazenamento seguro do servidor não está configurado Configure a chave de segurança antes de salvar tokens";
  }
  if (raw.includes("Integration credentials are not configured")) {
    return "Salve o token da API antes de testar a conexão";
  }
  if (raw.includes("Integration credentials are invalid")) {
    return "As credenciais salvas não são válidas Salve o token novamente";
  }
  if (raw.includes("Integration test_url")) {
    return "A URL de teste precisa ser HTTPS pública e usar a porta 443";
  }
  if (raw.includes("Integration connection failed")) {
    return "Não foi possível acessar o endereço configurado";
  }
  return "Não foi possível concluir a operação Verifique a conexão e tente novamente";
};

const setMessage = (text = "", type = "success") => {
  message.textContent = text ? translate(text) : "";
  message.hidden = !text;
  message.classList.toggle("is-error", type === "error" && Boolean(text));
  message.classList.toggle("is-success", type === "success" && Boolean(text));
};

const renderEmpty = (text) => `<p class="operation-empty" role="status">${escapeHtml(translate(text))}</p>`;
const parseSettings = (value) => {
  if (!value) return {};
  if (typeof value !== "string") return typeof value === "object" ? value : {};
  try {
    const settings = JSON.parse(value);
    return settings && typeof settings === "object" ? settings : {};
  } catch {
    return {};
  }
};

const renderConnections = (connections) => {
  list.setAttribute("aria-busy", "false");
  if (!connections.length) {
    list.innerHTML = renderEmpty("Nenhuma integração cadastrada");
    return;
  }

  list.innerHTML = connections.map((connection) => {
    const settings = parseSettings(connection.settings);
    const provider = translate(providerLabels[connection.provider] || "Provedor externo");
    const statusKey = Object.hasOwn(statusLabels, connection.status) ? connection.status : "unknown";
    const status = translate(statusLabels[statusKey] || "Status desconhecido");

    return `
      <article class="operation-card integration-card">
        <div class="operation-card__head">
          <strong>${escapeHtml(connection.display_name || provider)}</strong>
          <span class="operation-card__status operation-card__status--${statusKey}">${status}</span>
        </div>
        <div class="integration-card__details">
          <span>${translate("Provedor: ")}${escapeHtml(provider)}</span>
          ${settings.test_url ? `<span>${translate("URL de teste: ")}${escapeHtml(settings.test_url)}</span>` : ""}
        </div>
        ${connection.last_error ? `<p class="integration-card__error">${escapeHtml(translate(userFacingError({ message: connection.last_error })))}</p>` : ""}
        <details class="integration-credentials">
          <summary>${translate("Atualizar token da API")}</summary>
          <form class="integration-credentials__form" data-credentials-form data-integration-id="${escapeHtml(connection.id)}">
            <label>${translate("Token da API")}
              <input type="password" name="api_token" autocomplete="new-password" required />
            </label>
            <button class="btn btn--secondary" type="submit">${translate("Salvar token")}</button>
          </form>
        </details>
        <div class="integration-actions">
          <button class="btn btn--secondary" type="button" data-test-integration="${escapeHtml(connection.id)}">${translate("Testar conexão")}</button>
        </div>
      </article>
    `;
  }).join("");
};

const load = async () => {
  list.setAttribute("aria-busy", "true");
  list.innerHTML = renderEmpty("Carregando conexões");
  try {
    const data = await apiRequest(`/businesses/${businessId}/integrations`);
    renderConnections(Array.isArray(data.connections) ? data.connections : []);
    return true;
  } catch (error) {
    list.setAttribute("aria-busy", "false");
    list.innerHTML = `<div class="operation-empty" role="alert"><p>${escapeHtml(translate(userFacingError(error)))}</p><button class="btn btn--secondary" type="button" data-integration-retry>${translate("Tentar novamente")}</button></div>`;
    return false;
  }
};

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const provider = document.getElementById("integrationProvider").value;
  const name = document.getElementById("integrationName").value.trim();
  const testUrl = document.getElementById("integrationTestUrl").value.trim();
  const tokenInput = document.getElementById("integrationToken");
  const token = tokenInput.value.trim();

  if (!name) {
    document.getElementById("integrationName").focus();
    setMessage("Informe um nome para esta integração", "error");
    return;
  }

  createButton.disabled = true;
  setMessage();

  try {
    const created = await apiRequest(`/businesses/${businessId}/integrations`, {
      method: "POST",
      body: {
        provider,
        display_name: name,
        settings: { test_url: testUrl },
      },
    });
    const connectionId = created.connection.id;

    if (token) {
      try {
        await apiRequest(`/businesses/${businessId}/integrations/${connectionId}/credentials`, {
          method: "POST",
          body: { credentials: { api_token: token } },
        });
      } catch (error) {
        form.reset();
        await load();
        setMessage(
          `Integração cadastrada, mas o token não foi salvo. ${userFacingError(error)}`,
          "error"
        );
        return;
      }
    }

    form.reset();
    setMessage(token ? "Integração e credenciais salvas" : "Integração cadastrada Adicione o token para testar a conexão");
    await load();
  } catch (error) {
    setMessage(userFacingError(error), "error");
  } finally {
    createButton.disabled = false;
  }
});

list.addEventListener("submit", async (event) => {
  const credentialsForm = event.target.closest("[data-credentials-form]");
  if (!credentialsForm) return;
  event.preventDefault();

  const button = credentialsForm.querySelector("button[type='submit']");
  const input = credentialsForm.querySelector("input[name='api_token']");
  const token = input.value.trim();
  if (!token) {
    input.focus();
    return;
  }

  button.disabled = true;
  setMessage();

  try {
    await apiRequest(`/businesses/${businessId}/integrations/${credentialsForm.dataset.integrationId}/credentials`, {
      method: "POST",
      body: { credentials: { api_token: token } },
    });
    credentialsForm.reset();
    setMessage("Token salvo com segurança");
    await load();
  } catch (error) {
    setMessage(userFacingError(error), "error");
  } finally {
    if (button.isConnected) button.disabled = false;
  }
});

list.addEventListener("click", async (event) => {
  if (event.target.closest("[data-integration-retry]")) {
    void start();
    return;
  }
  const button = event.target.closest("[data-test-integration]");
  if (!button || button.disabled) return;

  button.disabled = true;
  setMessage();

  try {
    const result = await apiRequest(
      `/businesses/${businessId}/integrations/${button.dataset.testIntegration}/test`,
      { method: "POST" }
    );
    const status = Number(result.status);
    const testMessage = result.connected
      ? "Conexão aprovada"
      : Number.isFinite(status) && status > 0
        ? `O provedor respondeu com HTTP ${status}`
        : "O provedor não informou o status da conexão";
    setMessage(testMessage, result.connected ? "success" : "error");
    await load();
  } catch (error) {
    setMessage(userFacingError(error), "error");
    await load();
  } finally {
    if (button.isConnected) button.disabled = false;
  }
});

const start = async () => {
  try {
    if (!appShellReady) {
      await initAppShell({ activeNav: "integrations" });
      appShellReady = true;
    }
    await load();
  } catch (error) {
    const messageText = userFacingError(error);
    setMessage(messageText, "error");
    list.setAttribute("aria-busy", "false");
    list.innerHTML = `<div class="operation-empty" role="alert"><p>${escapeHtml(translate(messageText))}</p><button class="btn btn--secondary" type="button" data-integration-retry>${translate("Tentar novamente")}</button></div>`;
  }
};

void start();
