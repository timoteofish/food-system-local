import "../../../shared/i18n/legacy-control.js";
import { apiRequest } from "../../../shared/api/client.js";
import { getSession } from "../../../shared/data/storage.js";
import { escapeHtml } from "../../../shared/utils/utils.js";
import { translate } from "../../../shared/i18n/i18n.js";
import { initAppShell } from "../../../shared/ui/ui.js";

const businessId = getSession()?.businessId;
const documentList = document.getElementById("fiscalList");
const loadingIndicator = document.getElementById("fiscalLoading");
const errorModal = document.getElementById("fiscalErrorModal");
const loadErrorMessage = document.getElementById("fiscalLoadError");
const retryButton = document.getElementById("fiscalRetry");
const errorClose = document.getElementById("fiscalErrorClose");
const fiscalMessage = document.getElementById("fiscalMessage");
const createForm = document.getElementById("fiscalForm");
const createButton = createForm.querySelector("button[type='submit']");
let appShellReady = false;

const setLoading = (isLoading) => {
  loadingIndicator.hidden = !isLoading;
  if (isLoading) loadingIndicator.querySelector("[data-fiscal-loading-label]").textContent = translate("Loading");
};

const hideLoadError = () => {
  errorModal.hidden = true;
  document.body.classList.remove("modal-open");
};

const showLoadError = (error) => {
  setLoading(false);
  documentList.setAttribute("aria-busy", "false");
  documentList.replaceChildren();
  loadErrorMessage.textContent = translate(userFacingError(error));
  retryButton.disabled = false;
  errorModal.hidden = false;
  document.body.classList.add("modal-open");
  errorClose.focus();
};

errorModal.addEventListener("click", (event) => {
  if (event.target.closest("[data-close-fiscal-error]")) hideLoadError();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !errorModal.hidden) hideLoadError();
});

const statusLabels = {
  draft: "fiscalDraft",
  legacy: "fiscalLegacyStatus",
};
const documentTypeLabels = {
  nfce: "NFC-e",
  nfe: "NF-e",
  receipt: "Recibo",
};

const userFacingError = (error) => {
  const raw = error?.message || "fiscalOperationError";
  if (raw.includes("Fiscal issuance is disabled")) return "fiscalIssuanceDisabledError";
  return "fiscalConnectionError";
};

const setMessage = (element, text = "", type = "success") => {
  element.textContent = text ? translate(text) : "";
  element.hidden = !text;
  element.classList.toggle("is-error", type === "error" && Boolean(text));
  element.classList.toggle("is-success", type === "success" && Boolean(text));
};

const renderDocuments = (documents) => {
  documentList.setAttribute("aria-busy", "false");
  if (!documents.length) {
    documentList.innerHTML = `<p class="operation-empty">${translate("fiscalNoDocuments")}</p>`;
    return;
  }

  documentList.innerHTML = documents.map((document) => {
    const statusKey = document.status === "draft" ? "draft" : "legacy";
    const status = translate(statusLabels[statusKey]);
    const documentType = translate(documentTypeLabels[document.document_type] || "fiscalUnknownDocument");
    const identifier = document.number || String(document.id || "").slice(0, 8).toUpperCase();
    const errorMessage = document.error_message
      ? `<p class="fiscal-document__error">${escapeHtml(translate(document.error_message))}</p>`
      : "";
    const issueState = document.status === "draft"
      ? `<small>${translate("fiscalDraftSavedNotice")}</small>`
      : `<small>${translate("fiscalLegacyNotice")}</small>`;

    return `
      <article class="operation-card fiscal-item">
        <div class="fiscal-document__main">
          <strong>${escapeHtml(documentType)}</strong>
          <span>${escapeHtml(identifier || translate("fiscalNoNumber"))}</span>
          ${document.order_id ? `<small>${translate("fiscalOrderLabel")}${escapeHtml(document.order_id)}</small>` : ""}
        </div>
        <span class="operation-card__status fiscal-document__status fiscal-document__status--${statusKey}">${status}</span>
        ${errorMessage}
        ${issueState}
      </article>
    `;
  }).join("");
};

const load = async () => {
  setLoading(true);
  documentList.setAttribute("aria-busy", "true");
  documentList.replaceChildren();
  try {
    const data = await apiRequest(`/businesses/${businessId}/fiscal/documents`);
    renderDocuments(Array.isArray(data.documents) ? data.documents : []);
    setLoading(false);
    return true;
  } catch (error) {
    showLoadError(error);
    return false;
  }
};

retryButton.addEventListener("click", () => void start());

const start = async () => {
  hideLoadError();
  setLoading(true);
  retryButton.disabled = true;
  try {
    if (!appShellReady) {
      await initAppShell({ activeNav: "fiscal" });
      appShellReady = true;
    }
    await load();
  } catch (error) {
    showLoadError(error);
  } finally {
    retryButton.disabled = false;
  }
};

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
    setMessage(fiscalMessage, "fiscalDraftCreated");
    await load();
  } catch (error) {
    setMessage(fiscalMessage, userFacingError(error), "error");
  } finally {
    createButton.disabled = false;
  }
});

void start();
