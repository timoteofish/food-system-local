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
const loadingIndicator = document.getElementById("integrationLoading");
const errorModal = document.getElementById("integrationErrorModal");
const loadErrorMessage = document.getElementById("integrationLoadError");
const retryButton = document.getElementById("integrationRetry");
const errorClose = document.getElementById("integrationErrorClose");
let appShellReady = false;

const setLoading = (isLoading) => {
  loadingIndicator.hidden = !isLoading;
  if (isLoading) loadingIndicator.querySelector("[data-integration-loading-label]").textContent = translate("Loading");
};

const hideLoadError = () => {
  errorModal.hidden = true;
  document.body.classList.remove("modal-open");
};

const showLoadError = () => {
  setLoading(false);
  list.setAttribute("aria-busy", "false");
  list.replaceChildren();
  loadErrorMessage.textContent = translate("integrationLoadError");
  retryButton.disabled = false;
  errorModal.hidden = false;
  document.body.classList.add("modal-open");
  errorClose.focus();
};

errorModal.addEventListener("click", (event) => {
  if (event.target.closest("[data-close-integration-error]")) hideLoadError();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !errorModal.hidden) hideLoadError();
});

const providerLabels = {
  ifood: "iFood",
  "99food": "99Food",
  keeta: "Keeta",
  delivery_logistics: "Delivery logistics",
  payment: "Payments",
};
const statusLabels = {
  disconnected: "Disconnected",
  pending: "Webhook secret saved · awaiting test",
  reachable: "URL responded · provider not verified",
  error: "Connection failed",
  disabled: "Disabled",
};

const userFacingError = (error) => {
  const raw = error?.message || "Could not complete the operation";
  if (raw.includes("FOOD_SYSTEM_SECRET_KEY")) {
    return "Server secret storage is not configured. Set the key before saving the webhook secret";
  }
  if (raw.includes("Integration credentials are not configured")) {
    return "Set the generic webhook HMAC secret before receiving signed events";
  }
  if (raw.includes("Integration credentials are invalid")) {
    return "The saved HMAC secret is invalid. Update the webhook secret";
  }
  if (raw.includes("Integration test_url")) {
    return "The test URL must be a public HTTPS URL on port 443";
  }
  if (raw.includes("Integration connection failed")) {
    return "Could not reach the configured address";
  }
  return "Could not complete the operation. Check the connection and try again";
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
    list.innerHTML = renderEmpty("No integrations registered");
    return;
  }

  list.innerHTML = connections.map((connection) => {
    const settings = parseSettings(connection.settings);
    const provider = translate(providerLabels[connection.provider] || "External provider");
    const statusKey = Object.hasOwn(statusLabels, connection.status) ? connection.status : "unknown";
    const status = translate(statusLabels[statusKey] || "Unknown status");

    return `
      <article class="operation-card integration-card">
        <div class="operation-card__head">
          <strong>${escapeHtml(connection.display_name || provider)}</strong>
          <span class="operation-card__status operation-card__status--${statusKey}">${status}</span>
        </div>
        <div class="integration-card__details">
          <span>${translate("Provider: ")}${escapeHtml(provider)}</span>
          ${settings.test_url ? `<span>${translate("Test URL: ")}${escapeHtml(settings.test_url)}</span>` : ""}
          <small>${translate("Provider connector is not implemented yet")}</small>
        </div>
        ${connection.last_error ? `<p class="integration-card__error">${escapeHtml(translate(userFacingError({ message: connection.last_error })))}</p>` : ""}
        <details class="integration-credentials">
          <summary>${translate("Update webhook secret")}</summary>
          <form class="integration-credentials__form" data-credentials-form data-integration-id="${escapeHtml(connection.id)}">
            <label>${translate("Generic webhook secret")}
              <input type="password" name="webhook_secret" autocomplete="new-password" minlength="16" maxlength="512" required />
            </label>
            <button class="btn btn--secondary" type="submit">${translate("Save secret")}</button>
          </form>
        </details>
        <div class="integration-actions">
          <button class="btn btn--secondary" type="button" data-test-integration="${escapeHtml(connection.id)}">${translate("Test URL response")}</button>
        </div>
      </article>
    `;
  }).join("");
};

const load = async () => {
  setLoading(true);
  list.setAttribute("aria-busy", "true");
  list.replaceChildren();
  try {
    const data = await apiRequest(`/businesses/${businessId}/integrations`);
    renderConnections(Array.isArray(data.connections) ? data.connections : []);
    setLoading(false);
    return true;
  } catch (error) {
    showLoadError();
    return false;
  }
};

retryButton.addEventListener("click", () => void start());

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const provider = document.getElementById("integrationProvider").value;
  const name = document.getElementById("integrationName").value.trim();
  const testUrl = document.getElementById("integrationTestUrl").value.trim();
  const secretInput = document.getElementById("integrationWebhookSecret");
  const webhookSecret = secretInput.value.trim();

  if (!name) {
    document.getElementById("integrationName").focus();
    setMessage("Enter a name for this integration", "error");
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

    if (webhookSecret) {
      try {
        await apiRequest(`/businesses/${businessId}/integrations/${connectionId}/credentials`, {
          method: "POST",
          body: { credentials: { webhook_secret: webhookSecret } },
        });
      } catch (error) {
        form.reset();
        await load();
        setMessage(
          translate("integrationSecretSaveWarning").replace("$1", translate(userFacingError(error))),
          "error"
        );
        return;
      }
    }

    form.reset();
    setMessage(webhookSecret ? "Test settings and generic webhook secret saved; provider connector is not implemented" : "Test settings saved; provider connector is not implemented");
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
  const input = credentialsForm.querySelector("input[name='webhook_secret']");
  const webhookSecret = input.value.trim();
  if (!webhookSecret) {
    input.focus();
    return;
  }

  button.disabled = true;
  setMessage();

  try {
    await apiRequest(`/businesses/${businessId}/integrations/${credentialsForm.dataset.integrationId}/credentials`, {
      method: "POST",
      body: { credentials: { webhook_secret: webhookSecret } },
    });
    credentialsForm.reset();
    setMessage("Webhook HMAC secret saved; provider connector is not implemented");
    await load();
  } catch (error) {
    setMessage(userFacingError(error), "error");
  } finally {
    if (button.isConnected) button.disabled = false;
  }
});

list.addEventListener("click", async (event) => {
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
    const testMessage = result.reachable
      ? "Endpoint is reachable (HTTP 2xx); provider credentials were not checked"
      : Number.isFinite(status) && status > 0
        ? translate("integrationHttpResponse").replace("$1", String(status))
        : "The endpoint did not provide an HTTP status";
    setMessage(testMessage, result.reachable ? "success" : "error");
    await load();
  } catch (error) {
    setMessage(userFacingError(error), "error");
    await load();
  } finally {
    if (button.isConnected) button.disabled = false;
  }
});

const start = async () => {
  hideLoadError();
  setLoading(true);
  retryButton.disabled = true;
  try {
    if (!appShellReady) {
      await initAppShell({ activeNav: "integrations" });
      appShellReady = true;
    }
    await load();
  } catch (error) {
    showLoadError();
  } finally {
    retryButton.disabled = false;
  }
};

void start();
