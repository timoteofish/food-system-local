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
const createForm = document.getElementById("fiscalForm");
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

const userFacingError = (error) => {
  const raw = error?.message || "Não foi possível concluir a operação";
  if (raw.includes("Fiscal issuance is disabled")) return "A emissão fiscal está desativada até haver integração certificada";
  return "Não foi possível concluir a operação Verifique a conexão e tente novamente";
};

const setMessage = (element, text = "", type = "success") => {
  element.textContent = text ? translate(text) : "";
  element.hidden = !text;
  element.classList.toggle("is-error", type === "error" && Boolean(text));
  element.classList.toggle("is-success", type === "success" && Boolean(text));
};

const renderConfiguration = () => {
  configState.innerHTML = `<span class="fiscal-config-state__item is-missing"><span aria-hidden="true">!</span>${translate("Emissão desativada até existir integração fiscal certificada")}</span>`;
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
    const issueButton = document.status === "draft"
      ? `<small>${translate("Rascunho salvo · emissão desativada até integração certificada")}</small>`
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
    renderConfiguration();
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
