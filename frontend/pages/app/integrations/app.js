import { getSession } from "../../../shared/data/storage.js";
import { apiRequest } from "../../../shared/api/client.js";
import { initAppShell } from "../../../shared/ui/ui.js";

const businessId = getSession()?.businessId;
const list = document.getElementById("integrationList");
const message = document.getElementById("integrationMessage");
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));

const load = async () => {
  const data = await apiRequest(`/businesses/${businessId}/integrations`);
  list.innerHTML = data.connections.length ? data.connections.map((connection) => `<article class="integration-card"><strong>${escapeHtml(connection.display_name)}</strong><span>Provedor: ${escapeHtml(connection.provider)}</span><span>Status: ${escapeHtml(connection.status)}</span><small>Credenciais armazenadas com segurança; o token não é exibido.</small><div class="integration-actions"><button class="btn btn--secondary" data-test-integration="${escapeHtml(connection.id)}">Testar conexão</button></div></article>`).join("") : "Nenhuma integração configurada.";
};

document.getElementById("integrationForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  message.textContent = "";
  try {
    const provider = document.getElementById("integrationProvider").value;
    const created = await apiRequest(`/businesses/${businessId}/integrations`, { method: "POST", body: { provider, display_name: document.getElementById("integrationName").value.trim(), settings: { test_url: document.getElementById("integrationTestUrl").value.trim() } } });
    const token = document.getElementById("integrationToken").value;
    if (token) await apiRequest(`/businesses/${businessId}/integrations/${created.connection.id}/credentials`, { method: "POST", body: { credentials: { api_token: token } } });
    event.target.reset();
    message.textContent = "Integração salva.";
    await load();
  } catch (error) { message.textContent = error.message; }
});

list.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-test-integration]");
  if (!button) return;
  try { const result = await apiRequest(`/businesses/${businessId}/integrations/${button.dataset.testIntegration}/test`, { method: "POST" }); message.textContent = result.connected ? "Conexão aprovada." : `Provedor respondeu HTTP ${result.status}.`; await load(); } catch (error) { message.textContent = error.message; await load(); }
});

(async () => { await initAppShell({ activeNav: "integrations" }); await load(); })();
