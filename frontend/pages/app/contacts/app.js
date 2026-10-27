import { getLocale, translate } from "../../../shared/i18n/i18n.js";
import { apiRequest } from "../../../shared/api/client.js";
import { getSession } from "../../../shared/data/storage.js";
import { initAppShell, showToast } from "../../../shared/ui/ui.js";

const businessId = getSession()?.businessId;
const view = document.body.dataset.contactView || "customers";
const activeNav = view === "customers" ? "contacts" : view;
const money = new Intl.NumberFormat(getLocale(), { style: "currency", currency: "BRL" });
const number = new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 2 });
let loading = false;
let appShellReady = false;
const contactsLoadError = document.getElementById("contactsLoadError");
const contactsLoadRetry = document.getElementById("contactsLoadRetry");
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "'": "&#39;",
  '"': "&quot;",
}[character]));

const formatDiscount = (discount) => {
  const value = Number(discount.value || 0);
  return discount.type === "percentage" ? `${number.format(value)}%` : money.format(value);
};

const renderList = (element, rows, emptyMessage, getDetails) => {
  if (!element) return;
  element.setAttribute("aria-busy", "false");
  if (!rows.length) {
    element.innerHTML = `<p class="operation-empty">${translate(emptyMessage)}</p>`;
    return;
  }
  element.innerHTML = rows.map((row) => `
    <div class="contact-row">
      <strong>${escapeHtml(row.name)}</strong>
      <span>${escapeHtml(getDetails(row))}</span>
    </div>
  `).join("");
};

const setListError = (element, message) => {
  if (!element) return;
  element.setAttribute("aria-busy", "false");
  element.innerHTML = `<div class="operation-empty" role="alert"><p>${escapeHtml(message)}</p><button class="btn btn--secondary" type="button" data-contact-retry>${translate("Tentar novamente")}</button></div>`;
};

const load = async () => {
  if (loading) return;
  loading = true;
  const listConfigs = {
    customers: ["customerList", "Carregando clientes", "customers", "Nenhum cliente cadastrado", (customer) => customer.phone || customer.email || ""],
    suppliers: ["supplierList", "Carregando fornecedores", "suppliers", "Nenhum fornecedor cadastrado", (supplier) => supplier.phone || supplier.tax_id || ""],
    discounts: ["discountList", "Carregando descontos", "discounts", "Nenhum desconto cadastrado", (discount) => {
      const code = discount.code ? `${translate("Código: ")}${discount.code}` : translate("Sem código");
      return `${code} · ${formatDiscount(discount)}`;
    }],
  };
  const config = listConfigs[view];
  const list = config ? document.getElementById(config[0]) : null;
  if (list) {
    list.setAttribute("aria-busy", "true");
    list.innerHTML = `<p class="operation-empty" role="status">${translate(config[1])}</p>`;
  }
  const customerSelect = document.getElementById("loyaltyCustomer");

  try {
    const endpoint = view === "suppliers" ? "suppliers" : view === "discounts" ? "discounts" : "customers";
    const property = view === "suppliers" ? "suppliers" : view === "discounts" ? "discounts" : "customers";
    const result = await Promise.allSettled([apiRequest(`/businesses/${businessId}/${endpoint}`)]).then(([item]) => item);

    if (result.status === "rejected") {
      const message = translate("Não foi possível carregar os cadastros");
      setListError(list, message);
      if (customerSelect) {
        customerSelect.innerHTML = `<option value="">${translate("Não foi possível carregar os clientes")}</option>`;
        customerSelect.disabled = true;
      }
      if (list || customerSelect) showToast(message, { type: "error" });
      return;
    }

    const rows = Array.isArray(result.value[property]) ? result.value[property] : [];
    if (config) renderList(list, rows, config[3], config[4]);
    if (customerSelect) {
      customerSelect.innerHTML = [
        `<option value="">${translate("Selecione um cliente")}</option>`,
        ...rows.map((customer) => `<option value="${escapeHtml(customer.id)}">${escapeHtml(customer.name)}</option>`),
      ].join("");
      customerSelect.disabled = false;
    }
  } finally {
    loading = false;
  }
};

document.querySelector("main")?.addEventListener("click", (event) => {
  if (event.target.closest("[data-contact-retry]")) void load();
});

const formPayload = (form) => Object.fromEntries(new FormData(form).entries());
const bindCreateForm = ({ id, endpoint, resource, successMessage }) => {
  const form = document.getElementById(id);
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("button[type='submit']");
    button.disabled = true;
    try {
      await apiRequest(`/businesses/${businessId}/${endpoint}`, {
        method: "POST",
        body: { [resource]: formPayload(form) },
      });
      form.reset();
      showToast(translate(successMessage));
      await load();
    } catch {
      showToast(translate("Não foi possível salvar o cadastro"), { type: "error" });
    } finally {
      button.disabled = false;
    }
  });
};

bindCreateForm({ id: "customerForm", endpoint: "customers", resource: "customer", successMessage: "Cliente cadastrado" });
bindCreateForm({ id: "supplierForm", endpoint: "suppliers", resource: "supplier", successMessage: "Fornecedor cadastrado" });
bindCreateForm({ id: "discountForm", endpoint: "discounts", resource: "discount", successMessage: "Desconto criado" });

document.getElementById("loyaltyForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = event.submitter;
  const status = document.getElementById("loyaltyStatus");
  const customerId = document.getElementById("loyaltyCustomer").value;
  const points = Number(new FormData(form).get("points"));
  const action = button?.dataset.loyaltyAction === "redeem" ? "redeem" : "earn";
  if (!customerId) {
    document.getElementById("loyaltyCustomer").focus();
    return;
  }
  if (button) button.disabled = true;
  status.textContent = "";
  status.hidden = true;
  try {
    const data = await apiRequest(`/businesses/${businessId}/customers/${customerId}/loyalty/${action}`, {
      method: "POST",
      body: { points },
    });
    status.textContent = `${translate("Saldo de pontos: ")}${number.format(data.points)}`;
    status.hidden = false;
    form.reset();
    await load();
  } catch {
    showToast(translate("Não foi possível atualizar os pontos"), { type: "error" });
  } finally {
    if (button) button.disabled = false;
  }
});

const start = async () => {
  if (contactsLoadRetry) {
    contactsLoadRetry.hidden = true;
    contactsLoadRetry.disabled = true;
  }
  if (contactsLoadError) contactsLoadError.hidden = true;
  try {
    if (!appShellReady) {
      await initAppShell({ activeNav });
      appShellReady = true;
    }
    await load();
  } catch {
    if (contactsLoadError) {
      contactsLoadError.textContent = translate("Não foi possível abrir os cadastros");
      contactsLoadError.hidden = false;
    }
    if (contactsLoadRetry) contactsLoadRetry.hidden = false;
  } finally {
    if (contactsLoadRetry) contactsLoadRetry.disabled = false;
  }
};

contactsLoadRetry?.addEventListener("click", () => void start());
void start();
