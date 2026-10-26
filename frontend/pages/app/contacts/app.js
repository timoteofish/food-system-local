import { getLocale, translate } from "../../../shared/i18n/i18n.js";
import { apiRequest } from "../../../shared/api/client.js";
import { getSession } from "../../../shared/data/storage.js";
import { initAppShell, showToast } from "../../../shared/ui/ui.js";

const businessId = getSession()?.businessId;
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
  element.setAttribute("aria-busy", "false");
  element.innerHTML = `<div class="operation-empty" role="alert"><p>${escapeHtml(message)}</p><button class="btn btn--secondary" type="button" data-contact-retry>${translate("Tentar novamente")}</button></div>`;
};

const load = async () => {
  if (loading) return;
  loading = true;
  const loadingLists = [
    ["customerList", "Carregando clientes"],
    ["supplierList", "Carregando fornecedores"],
    ["discountList", "Carregando descontos"],
  ];
  loadingLists.forEach(([id, message]) => {
    const element = document.getElementById(id);
    element.setAttribute("aria-busy", "true");
    element.innerHTML = `<p class="operation-empty" role="status">${translate(message)}</p>`;
  });
  try {
    const results = await Promise.allSettled([
      apiRequest(`/businesses/${businessId}/customers`),
      apiRequest(`/businesses/${businessId}/suppliers`),
      apiRequest(`/businesses/${businessId}/discounts`),
    ]);
    const [customersResult, suppliersResult, discountsResult] = results;
    const listResults = [
      [customersResult, "customerList", "customers", "Nenhum cliente cadastrado", (customer) => customer.phone || customer.email || ""],
      [suppliersResult, "supplierList", "suppliers", "Nenhum fornecedor cadastrado", (supplier) => supplier.phone || supplier.tax_id || ""],
      [discountsResult, "discountList", "discounts", "Nenhum desconto cadastrado", (discount) => {
        const code = discount.code ? `${translate("Código: ")}${discount.code}` : translate("Sem código");
        return `${code} · ${formatDiscount(discount)}`;
      }],
    ];
    const errors = [];

    listResults.forEach(([result, id, property, emptyMessage, getDetails]) => {
      const element = document.getElementById(id);
      if (result.status === "rejected") {
        const message = translate("Não foi possível carregar os cadastros.");
        errors.push(message);
        setListError(element, message);
        return;
      }
      const rows = Array.isArray(result.value[property]) ? result.value[property] : [];
      renderList(element, rows, emptyMessage, getDetails);
    });

    const customerSelect = document.getElementById("loyaltyCustomer");
    if (customersResult.status === "fulfilled") {
      const customers = Array.isArray(customersResult.value.customers) ? customersResult.value.customers : [];
      customerSelect.innerHTML = [
        `<option value="">${translate("Selecione um cliente")}</option>`,
        ...customers.map((customer) => `<option value="${escapeHtml(customer.id)}">${escapeHtml(customer.name)}</option>`),
      ].join("");
      customerSelect.disabled = false;
    } else {
      customerSelect.innerHTML = `<option value="">${translate("Não foi possível carregar os clientes.")}</option>`;
      customerSelect.disabled = true;
    }

    if (errors.length) showToast(errors[0], { type: "error" });
  } finally {
    loading = false;
  }
};

document.querySelector("main").addEventListener("click", (event) => {
  if (event.target.closest("[data-contact-retry]")) void load();
});

const formPayload = (form) => Object.fromEntries(new FormData(form).entries());

const bindCreateForm = ({ id, endpoint, resource, successMessage }) => {
  const form = document.getElementById(id);
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
    } catch (error) {
      showToast(translate("Não foi possível salvar o cadastro."), { type: "error" });
    } finally {
      button.disabled = false;
    }
  });
};

bindCreateForm({
  id: "customerForm",
  endpoint: "customers",
  resource: "customer",
  successMessage: "Cliente cadastrado",
});
bindCreateForm({
  id: "supplierForm",
  endpoint: "suppliers",
  resource: "supplier",
  successMessage: "Fornecedor cadastrado",
});
bindCreateForm({
  id: "discountForm",
  endpoint: "discounts",
  resource: "discount",
  successMessage: "Desconto criado",
});

document.getElementById("loyaltyForm").addEventListener("submit", async (event) => {
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
  } catch (error) {
    showToast(translate("Não foi possível atualizar os pontos."), { type: "error" });
  } finally {
    if (button) button.disabled = false;
  }
});

const start = async () => {
  contactsLoadRetry.hidden = true;
  contactsLoadRetry.disabled = true;
  contactsLoadError.hidden = true;
  try {
    if (!appShellReady) {
      await initAppShell({ activeNav: "contacts" });
      appShellReady = true;
    }
    await load();
  } catch (error) {
    contactsLoadError.textContent = translate("Não foi possível abrir os cadastros.");
    contactsLoadError.hidden = false;
    contactsLoadRetry.hidden = false;
  } finally {
    contactsLoadRetry.disabled = false;
  }
};

contactsLoadRetry.addEventListener("click", () => void start());
void start();
