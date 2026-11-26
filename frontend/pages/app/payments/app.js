import {
  chargePaymentTerminal,
  createGatewayCheckout,
  createPaymentGateway,
  createPaymentTerminal,
  deletePaymentGateway,
  deletePaymentTerminal,
  fetchCardPayments,
  fetchPaymentGateways,
  fetchPaymentTerminals,
} from "../../../shared/api/client.js";
import { getSession } from "../../../shared/data/storage.js";
import { escapeHtml } from "../../../shared/utils/utils.js";
import { openExternalUrl } from "../../../shared/utils/open-external.js";
import { initAppShell } from "../../../shared/ui/ui.js";

const businessId = getSession()?.businessId;
const message = document.getElementById("paymentsMessage");
const terminalForm = document.getElementById("terminalForm");
const gatewayForm = document.getElementById("gatewayForm");
const chargeForm = document.getElementById("chargeForm");
const terminalList = document.getElementById("terminalList");
const gatewayList = document.getElementById("gatewayList");
const paymentList = document.getElementById("paymentList");
const sourceType = chargeForm.querySelector("select[name='source_type']");
const sourceSelect = chargeForm.querySelector("select[name='source_id']");

let terminals = [];
let gateways = [];
let appShellReady = false;

const showMessage = (text, type = "success") => {
  message.textContent = text;
  message.hidden = !text;
  message.classList.toggle("is-success", type === "success");
  message.classList.toggle("is-error", type === "error");
};

const load = async () => {
  showMessage("");
  try {
    [terminals, gateways] = await Promise.all([fetchPaymentTerminals(businessId), fetchPaymentGateways(businessId)]);
    renderSources();
    renderLists();
    const payments = await fetchCardPayments(businessId);
    paymentList.innerHTML = payments.length
      ? payments.map((item) => `<article class="payment-item"><strong>${escapeHtml(item.source_type)} · ${escapeHtml(item.status)}</strong><span>${escapeHtml(String(item.amount))} · ${escapeHtml(item.created_at || "")}</span></article>`).join("")
      : `<p class="operation-empty">Nenhum pagamento registrado</p>`;
  } catch {
    showMessage("Não foi possível carregar os pagamentos", "error");
  }
};

const renderSources = () => {
  const items = sourceType.value === "terminal" ? terminals : gateways;
  sourceSelect.innerHTML = items.length
    ? items.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.display_name || item.provider)}</option>`).join("")
    : `<option value="">Nenhum disponível</option>`;
};

const renderLists = () => {
  terminalList.innerHTML = terminals.length
    ? terminals.map((item) => `<article class="payment-item"><div><strong>${escapeHtml(item.display_name)}</strong><span>${escapeHtml(item.provider)} · ${escapeHtml(item.endpoint_url)}</span></div><button type="button" class="btn btn--secondary" data-delete-terminal="${escapeHtml(item.id)}">Remover</button></article>`).join("")
    : `<p class="operation-empty">Nenhuma maquineta cadastrada</p>`;
  gatewayList.innerHTML = gateways.length
    ? gateways.map((item) => `<article class="payment-item"><div><strong>${escapeHtml(item.display_name)}</strong><span>${escapeHtml(item.provider)}</span></div><button type="button" class="btn btn--secondary" data-delete-gateway="${escapeHtml(item.id)}">Remover</button></article>`).join("")
    : `<p class="operation-empty">Nenhum gateway cadastrado</p>`;
};

sourceType.addEventListener("change", renderSources);

terminalForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showMessage("");
  const data = Object.fromEntries(new FormData(terminalForm).entries());
  try {
    await createPaymentTerminal(businessId, data);
    terminalForm.reset();
    showMessage("Terminal adicionado");
    await load();
  } catch {
    showMessage("Não foi possível adicionar o terminal", "error");
  }
});

gatewayForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showMessage("");
  const data = Object.fromEntries(new FormData(gatewayForm).entries());
  try {
    await createPaymentGateway(businessId, data);
    gatewayForm.reset();
    showMessage("Gateway adicionado");
    await load();
  } catch {
    showMessage("Não foi possível adicionar o gateway", "error");
  }
});

chargeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showMessage("");
  const data = Object.fromEntries(new FormData(chargeForm).entries());
  if (!data.source_id) return showMessage("Cadastre uma origem primeiro", "error");
  try {
    if (data.source_type === "terminal") {
      const payment = await chargePaymentTerminal(businessId, data.source_id, {
        order_id: data.order_id,
        amount: Number(data.amount),
        installments: Number(data.installments || 1),
      });
      showMessage(payment.status === "approved" ? "Pagamento aprovado" : `Pagamento: ${payment.status}`);
      if (payment.checkout_url) void openExternalUrl(payment.checkout_url);
    } else {
      const payment = await createGatewayCheckout(businessId, data.source_id, {
        order_id: data.order_id,
        amount: Number(data.amount),
      });
      showMessage("Checkout criado");
      void openExternalUrl(payment.checkout_url);
    }
    await load();
  } catch (error) {
    showMessage(error.message || "Não foi possível cobrar", "error");
  }
});

terminalList.addEventListener("click", async (event) => {
  const id = event.target.closest("[data-delete-terminal]")?.dataset.deleteTerminal;
  if (!id) return;
  try {
    await deletePaymentTerminal(businessId, id);
    await load();
  } catch {
    showMessage("Não foi possível remover o terminal", "error");
  }
});

gatewayList.addEventListener("click", async (event) => {
  const id = event.target.closest("[data-delete-gateway]")?.dataset.deleteGateway;
  if (!id) return;
  try {
    await deletePaymentGateway(businessId, id);
    await load();
  } catch {
    showMessage("Não foi possível remover o gateway", "error");
  }
});

const start = async () => {
  try {
    if (!appShellReady) {
      await initAppShell({ activeNav: "payments" });
      appShellReady = true;
    }
    await load();
  } catch {
    showMessage("Não foi possível iniciar a página de pagamentos", "error");
  }
};

void start();
