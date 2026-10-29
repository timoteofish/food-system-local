import "../../../shared/i18n/legacy-control.js";
import { apiRequest } from "../../../shared/api/client.js";
import { getSession } from "../../../shared/data/storage.js";
import { escapeHtml } from "../../../shared/utils/utils.js";
import { translate } from "../../../shared/i18n/i18n.js";
import { initAppShell } from "../../../shared/ui/ui.js";

const businessId = getSession()?.businessId;
const documentList = document.getElementById("fiscalList");
const configState = document.getElementById("fiscalConfigurationState");
const fiscalMessage = document.getElementById("fiscalMessage");
const credentialsMessage = document.getElementById("fiscalCredentialsMessage");
const credentialsForm = document.getElementById("fiscalCredentialsForm");
const createForm = document.getElementById("fiscalForm");
const credentialsButton = credentialsForm.querySelector("button[type='submit']");
const createButton = createForm.querySelector("button[type='submit']");

const statusLabels = {
  draft: "Rascunho",
  pending: "Em processamento",
  authorized: "Autorizado",
  issued: "Emitido",
  rejected: "Rejeitado",
  cancelled: "Cancelado",
};
const documentTypeLabels = {
  nfce: "NFC-e",
  nfe: "NF-e",
  receipt: "Recibo",
};
let canIssueDocuments = false;

const userFacingError = (error) => {
  const raw = error?.message || "Não foi possível concluir a operação";
  if (raw.includes("FISCAL_PROVIDER_URL") || raw.includes("Fiscal provider is not configured")) {
    return "O endpoint HTTPS do provedor não está configurado no servidor";
  }
  if (raw.includes("FOOD_SYSTEM_SECRET_KEY")) {
    return "O armazenamento seguro do servidor não está configurado Configure a chave antes de salvar credenciais";
  }
  if (raw.includes("Fiscal provider credentials are not configured")) {
    return "Cadastre as credenciais do provedor antes de enviar documentos";
  }
  if (raw.includes("Fiscal provider credentials are invalid")) {
    return "As credenciais salvas não são válidas Atualize os dados do provedor";
  }
  if (raw.includes("Fiscal provider must use HTTPS")) {
    return "O endereço do provedor precisa usar HTTPS";
  }
  if (raw.includes("Fiscal provider request failed")) {
    return "O provedor não conseguiu processar o documento Confira a configuração e tente novamente";
  }
  if (raw.includes("Draft fiscal document not found")) {
    return "Este rascunho não está mais disponível para emissão";
  }
  return "Não foi possível concluir a operação Verifique a conexão e tente novamente";
};

const setMessage = (element, text = "", type = "success") => {
  element.textContent = text ? translate(text) : "";
  element.hidden = !text;
  element.classList.toggle("is-error", type === "error" && Boolean(text));
  element.classList.toggle("is-success", type === "success" && Boolean(text));
};

const renderConfiguration = (configuration = {}) => {
  const providerConfigured = Boolean(configuration.providerConfigured);
  const secureStorageAvailable = Boolean(configuration.secureStorageAvailable);
  const credentialsStored = Boolean(configuration.credentialsStored);
  canIssueDocuments = providerConfigured && secureStorageAvailable && credentialsStored;

  const states = [
    {
      ready: providerConfigured,
      label: translate(providerConfigured ? "Endpoint HTTPS configurado" : "Endpoint HTTPS não configurado"),
    },
    {
      ready: secureStorageAvailable,
      label: translate(secureStorageAvailable ? "Armazenamento seguro disponível" : "Chave de segurança ausente no servidor"),
    },
    {
      ready: credentialsStored,
      label: translate(credentialsStored ? "Credenciais do provedor salvas" : "Credenciais do provedor não cadastradas"),
    },
  ];

  configState.innerHTML = states.map((state) => `
    <span class="fiscal-config-state__item ${state.ready ? "is-ready" : "is-missing"}">
      <span aria-hidden="true">${state.ready ? "✓" : "!"}</span>
      ${state.label}
    </span>
  `).join("");
};

const renderDocuments = (documents) => {
  documentList.setAttribute("aria-busy", "false");
  if (!documents.length) {
    documentList.innerHTML = `<p class="operation-empty">${translate("Nenhum documento fiscal cadastrado")}</p>`;
    return;
  }

  documentList.innerHTML = documents.map((document) => {
    const statusKey = Object.hasOwn(statusLabels, document.status) ? document.status : "unknown";
    const status = translate(statusLabels[statusKey] || "Status desconhecido");
    const documentType = translate(documentTypeLabels[document.document_type] || "Documento fiscal");
    const identifier = document.number || String(document.id || "").slice(0, 8).toUpperCase();
    const errorMessage = document.error_message
      ? `<p class="fiscal-document__error">${escapeHtml(translate(document.error_message))}</p>`
      : "";
    const payloadReady = document.payload && typeof document.payload === "object" && !Array.isArray(document.payload) && Object.keys(document.payload).length > 0;
    const issueButton = document.status === "draft" && payloadReady
      ? `<button class="btn btn--secondary" data-issue="${escapeHtml(document.id)}" type="button" ${canIssueDocuments ? "" : "disabled"}>${translate("Enviar para emissão")}</button>`
      : document.status === "draft"
        ? `<small>${translate("Rascunho sem dados fiscais")}</small>`
      : "";

    return `
      <article class="operation-card fiscal-item">
        <div class="fiscal-document__main">
          <strong>${escapeHtml(documentType)}</strong>
          <span>${escapeHtml(identifier || "Sem número")}</span>
          ${document.order_id ? `<small>${translate("Pedido: ")}${escapeHtml(document.order_id)}</small>` : ""}
        </div>
        <span class="operation-card__status fiscal-document__status fiscal-document__status--${statusKey}">${status}</span>
        ${errorMessage}
        ${issueButton}
      </article>
    `;
  }).join("");
};

const load = async () => {
  documentList.setAttribute("aria-busy", "true");
  documentList.innerHTML = `<p class="operation-empty" role="status">${translate("Carregando documentos")}</p>`;
  try {
    const data = await apiRequest(`/businesses/${businessId}/fiscal/documents`);
    renderConfiguration(data.configuration || {});
    renderDocuments(Array.isArray(data.documents) ? data.documents : []);
    return true;
  } catch (error) {
    documentList.setAttribute("aria-busy", "false");
    documentList.innerHTML = `<p class="operation-empty" role="alert">${escapeHtml(translate(userFacingError(error)))}</p><button class="btn btn--secondary fiscal-retry" type="button">${translate("Tentar novamente")}</button>`;
    renderConfiguration();
    return false;
  }
};

documentList.addEventListener("click", (event) => {
  if (event.target.closest(".fiscal-retry")) void load();
});

credentialsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const credentials = Object.fromEntries(
    Array.from(credentialsForm.querySelectorAll("[name]"))
      .map((field) => [field.name, field.value.trim()])
      .filter(([, value]) => Boolean(value))
  );

  if (!Object.keys(credentials).length) {
    setMessage(credentialsMessage, "Preencha ao menos um campo para atualizar as credenciais", "error");
    credentialsForm.querySelector("input, textarea").focus();
    return;
  }

  credentialsButton.disabled = true;
  setMessage(credentialsMessage);

  try {
    await apiRequest(`/businesses/${businessId}/fiscal/credentials`, {
      method: "PUT",
      body: { credentials },
    });
    credentialsForm.reset();
    setMessage(credentialsMessage, "Credenciais atualizadas com segurança");
    await load();
  } catch (error) {
    setMessage(credentialsMessage, userFacingError(error), "error");
  } finally {
    credentialsButton.disabled = false;
  }
});

createForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(createForm);
  const orderId = String(data.get("order_id") || "").trim();
  createButton.disabled = true;
  setMessage(fiscalMessage);

  try {
    await apiRequest(`/businesses/${businessId}/fiscal/documents`, {
      method: "POST",
      body: {
        document_type: data.get("document_type"),
        order_id: orderId || undefined,
        payload: {},
      },
    });
    createForm.reset();
    setMessage(fiscalMessage, "Rascunho fiscal criado");
    await load();
  } catch (error) {
    setMessage(fiscalMessage, userFacingError(error), "error");
  } finally {
    createButton.disabled = false;
  }
});

documentList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-issue]");
  if (!button || button.disabled) return;

  button.disabled = true;
  setMessage(fiscalMessage);

  try {
    const result = await apiRequest(
      `/businesses/${businessId}/fiscal/documents/${button.dataset.issue}/issue`,
      { method: "POST" }
    );
    setMessage(fiscalMessage, result.document?.status === "authorized"
      ? "Documento autorizado pelo provedor"
      : "O provedor não autorizou o documento Consulte o motivo na fila", result.document?.status === "authorized" ? "success" : "error");
    await load();
  } catch (error) {
    setMessage(fiscalMessage, userFacingError(error), "error");
    await load();
  } finally {
    if (button.isConnected) button.disabled = false;
  }
});

const start = async () => {
  try {
    await initAppShell({ activeNav: "fiscal" });
    await load();
  } catch (error) {
    setMessage(fiscalMessage, userFacingError(error), "error");
    documentList.setAttribute("aria-busy", "false");
  }
};

void start();
