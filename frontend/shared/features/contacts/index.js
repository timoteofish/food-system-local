import { getLocale, translate } from "../../i18n/i18n.js";
import { apiRequest } from "../../api/client.js";
import { getSession } from "../../data/storage.js";
import { initAppShell, showToast } from "../../ui/ui.js";

const businessId = getSession()?.businessId;
const view = document.body.dataset.contactView || "customers";
const activeNav = view === "customers" ? "contacts" : view;
const money = new Intl.NumberFormat(getLocale(), { style: "currency", currency: "BRL" });
const number = new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 2 });
const discountNumber = new Intl.NumberFormat(getLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const localeParts = new Intl.NumberFormat(getLocale()).formatToParts(1000.1);
const decimalSeparator = localeParts.find((part) => part.type === "decimal")?.value || ".";
const groupSeparator = localeParts.find((part) => part.type === "group")?.value || ",";
let loading = false;
let appShellReady = false;
let customerRows = [];
const contactsLoadError = document.getElementById("contactsLoadError");
const contactsLoadRetry = document.getElementById("contactsLoadRetry");
const contactsErrorModal = document.getElementById("contactsErrorModal");
const contactsErrorClose = document.querySelector(".contacts-error-panel__close");
const contactsPageLoading = document.getElementById("contactsPageLoading");
const customerSearch = document.getElementById("customerSearch");
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

const discountTypeInput = document.querySelector("#discountForm [name='type']");
const discountValueInput = document.querySelector("#discountForm [name='value']");
const discountCurrencyPrefix = document.querySelector("[data-discount-currency]");
const discountPercentSuffix = document.querySelector("[data-discount-percent]");
const supplierTaxIdInput = document.querySelector("#supplierForm [name='tax_id']");

const formatTaxId = (value) => {
  const chars = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 14);
  if (!/[A-Z]/.test(chars) && chars.length <= 11) {
    if (chars.length > 9) return `${chars.slice(0, 3)}.${chars.slice(3, 6)}.${chars.slice(6, 9)}-${chars.slice(9)}`;
    if (chars.length > 6) return `${chars.slice(0, 3)}.${chars.slice(3, 6)}.${chars.slice(6)}`;
    if (chars.length > 3) return `${chars.slice(0, 3)}.${chars.slice(3)}`;
    return chars;
  }
  if (chars.length > 12) return `${chars.slice(0, 2)}.${chars.slice(2, 5)}.${chars.slice(5, 8)}/${chars.slice(8, 12)}-${chars.slice(12)}`;
  if (chars.length > 8) return `${chars.slice(0, 2)}.${chars.slice(2, 5)}.${chars.slice(5, 8)}/${chars.slice(8)}`;
  if (chars.length > 5) return `${chars.slice(0, 2)}.${chars.slice(2, 5)}.${chars.slice(5)}`;
  if (chars.length > 2) return `${chars.slice(0, 2)}.${chars.slice(2)}`;
  return chars;
};

const hasValidTaxDigits = (value) => {
  const calculateDigit = (values, weights) => {
    const remainder = [...values].reduce((sum, character, index) => sum + (character.charCodeAt(0) - 48) * weights[index], 0) % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  const digits = value.replace(/\D/g, "");
  if (/^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(value)) {
    if (/^(\d)\1+$/.test(digits)) return false;
    const first = calculateDigit(digits.slice(0, 9), [10, 9, 8, 7, 6, 5, 4, 3, 2]);
    const second = calculateDigit(digits.slice(0, 9) + first, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
    return Number(digits[9]) === first && Number(digits[10]) === second;
  }
  if (/^[0-9A-Z]{2}\.[0-9A-Z]{3}\.[0-9A-Z]{3}\/[0-9A-Z]{4}-\d{2}$/.test(value)) {
    const cnpj = value.replace(/[./-]/g, "");
    if (/^(\d)\1{13}$/.test(cnpj)) return false;
    const first = calculateDigit(cnpj.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
    const second = calculateDigit(cnpj.slice(0, 12) + first, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
    return Number(cnpj[12]) === first && Number(cnpj[13]) === second;
  }
  return false;
};

supplierTaxIdInput?.addEventListener("input", () => {
  supplierTaxIdInput.value = formatTaxId(supplierTaxIdInput.value);
  supplierTaxIdInput.setCustomValidity("");
});
supplierTaxIdInput?.addEventListener("blur", () => {
  const value = supplierTaxIdInput.value.trim();
  const valid = !value || hasValidTaxDigits(value);
  supplierTaxIdInput.setCustomValidity(valid ? "" : "Informe um CPF ou CNPJ válido.");
});

const readDiscountValue = (value) => {
  const raw = String(value ?? "").trim().replaceAll(groupSeparator, "");
  if (!raw || !new RegExp(`^\\d+(?:${decimalSeparator === "." ? "\\." : decimalSeparator}\\d{0,2})?$`).test(raw)) return null;
  const parsed = Number(raw.replace(decimalSeparator, "."));
  return Number.isFinite(parsed) ? parsed : null;
};

const updateDiscountValueMode = (format = false) => {
  if (!discountTypeInput || !discountValueInput) return;
  const fixed = discountTypeInput.value === "fixed";
  discountCurrencyPrefix.hidden = !fixed;
  discountPercentSuffix.hidden = fixed;
  discountValueInput.placeholder = fixed ? discountNumber.format(10) : number.format(10);
  const value = readDiscountValue(discountValueInput.value);
  if (format && value !== null) {
    discountValueInput.value = fixed ? discountNumber.format(value) : number.format(value);
  }
};

discountTypeInput?.addEventListener("change", () => updateDiscountValueMode(true));
discountValueInput?.addEventListener("input", () => {
  const characters = [...discountValueInput.value].filter((character) => /\d/.test(character) || character === decimalSeparator);
  const separatorIndex = characters.indexOf(decimalSeparator);
  const normalized = separatorIndex < 0
    ? characters.join("")
    : `${characters.slice(0, separatorIndex).join("")}${decimalSeparator}${characters.slice(separatorIndex + 1).filter((character) => /\d/.test(character)).slice(0, 2).join("")}`;
  discountValueInput.value = normalized;
});
discountValueInput?.addEventListener("blur", () => updateDiscountValueMode(true));
updateDiscountValueMode();

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

const renderCustomerList = () => {
  const list = document.getElementById("customerList");
  if (!list) return;
  const normalizeSearch = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();
  const query = normalizeSearch(customerSearch?.value || "").trim();
  const filtered = customerRows.filter((customer) =>
    [customer.name, customer.phone, customer.email]
      .some((value) => normalizeSearch(value).includes(query))
  );
  if (customerRows.length && !filtered.length) {
    list.setAttribute("aria-busy", "false");
    list.innerHTML = `<p class="operation-empty">Nenhum cliente corresponde à pesquisa.</p>`;
    return;
  }
  renderList(list, filtered, "No customers added", (customer) => customer.phone || customer.email || "");
};

customerSearch?.addEventListener("input", renderCustomerList);

const setListError = (element) => {
  if (!element) return;
  element.setAttribute("aria-busy", "false");
  element.replaceChildren();
};

const showContactsError = () => {
  setContactsLoading(false);
  contactsLoadError.textContent = translate("loadRetryError");
  contactsLoadError.hidden = false;
  contactsLoadRetry.hidden = false;
  contactsLoadRetry.disabled = false;
  if (!contactsErrorModal) {
    contactsLoadError.hidden = false;
    return;
  }
  contactsErrorModal.hidden = false;
  document.body.classList.add("modal-open");
  contactsErrorClose?.focus();
};

const hideContactsError = () => {
  if (contactsErrorModal) contactsErrorModal.hidden = true;
  if (contactsLoadError) contactsLoadError.hidden = true;
  if (contactsLoadRetry) contactsLoadRetry.hidden = true;
  document.body.classList.remove("modal-open");
};

const setContactsLoading = (isLoading) => {
  if (!contactsPageLoading) return;
  contactsPageLoading.hidden = !isLoading;
  if (isLoading) {
    contactsPageLoading.querySelector("[data-contacts-loading-label]").textContent = translate("Loading");
  }
};

contactsErrorModal?.addEventListener("click", (event) => {
  if (event.target.closest("[data-close-contact-error]")) hideContactsError();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && contactsErrorModal && !contactsErrorModal.hidden) hideContactsError();
});

const load = async () => {
  if (loading) return;
  loading = true;
  setContactsLoading(true);
  const listConfigs = {
    customers: ["customerList", "Loading customers", "customers", "No customers added", (customer) => customer.phone || customer.email || ""],
    suppliers: ["supplierList", "Loading suppliers", "suppliers", "No suppliers added", (supplier) => supplier.phone || supplier.tax_id || ""],
    discounts: ["discountList", "Loading discounts", "discounts", "No discounts added", (discount) => {
      const code = discount.code ? `${translate("Code: ")}${discount.code}` : translate("No code");
      return `${code} · ${formatDiscount(discount)}`;
    }],
  };
  const config = listConfigs[view];
  const list = config ? document.getElementById(config[0]) : null;
  if (list) {
    list.setAttribute("aria-busy", "true");
    if (view === "customers") customerRows = [];
    if (contactsPageLoading) list.replaceChildren();
    else list.innerHTML = `<p class="operation-empty" role="status">${translate(config[1])}</p>`;
  }
  const customerSelect = document.getElementById("loyaltyCustomer");

  try {
    const endpoint = view === "suppliers" ? "suppliers" : view === "discounts" ? "discounts" : "customers";
    const property = view === "suppliers" ? "suppliers" : view === "discounts" ? "discounts" : "customers";
    const result = await Promise.allSettled([apiRequest(`/businesses/${businessId}/${endpoint}`)]).then(([item]) => item);

    if (result.status === "rejected") {
      setListError(list);
      showContactsError();
      if (customerSelect) {
        customerSelect.innerHTML = `<option value="">${translate("Could not load customers")}</option>`;
        customerSelect.disabled = true;
      }
      return;
    }

    const rows = Array.isArray(result.value[property]) ? result.value[property] : [];
    if (view === "customers") {
      customerRows = rows;
      renderCustomerList();
    } else if (config) renderList(list, rows, config[3], config[4]);
    if (customerSelect) {
      customerSelect.innerHTML = [
        `<option value="">${translate("Select a customer")}</option>`,
        ...rows.map((customer) => `<option value="${escapeHtml(customer.id)}">${escapeHtml(customer.name)}</option>`),
      ].join("");
      customerSelect.disabled = false;
    }
  } finally {
    loading = false;
    setContactsLoading(false);
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
    if (resource === "supplier" && supplierTaxIdInput) {
      supplierTaxIdInput.dispatchEvent(new Event("blur"));
      if (!supplierTaxIdInput.reportValidity()) return;
    }
    const payload = formPayload(form);
    if (resource === "discount") {
      const value = readDiscountValue(payload.value);
      if (value === null || value <= 0 || (payload.type === "percentage" && value > 100)) {
        discountValueInput?.focus();
        return;
      }
      payload.value = value;
    }
    const button = form.querySelector("button[type='submit']");
    button.disabled = true;
    try {
      await apiRequest(`/businesses/${businessId}/${endpoint}`, {
        method: "POST",
        body: { [resource]: payload },
      });
      form.reset();
      showToast(translate(successMessage));
      await load();
    } catch {
      showToast(translate("Could not save the record"), { type: "error" });
    } finally {
      button.disabled = false;
    }
  });
};

bindCreateForm({ id: "customerForm", endpoint: "customers", resource: "customer", successMessage: "Customer added" });
bindCreateForm({ id: "supplierForm", endpoint: "suppliers", resource: "supplier", successMessage: "Supplier added" });
bindCreateForm({ id: "discountForm", endpoint: "discounts", resource: "discount", successMessage: "Discount created" });

const loyaltyPointsInput = document.querySelector("#loyaltyForm [name='points']");
loyaltyPointsInput?.addEventListener("input", () => {
  loyaltyPointsInput.value = loyaltyPointsInput.value.replace(/\D/g, "");
});

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
  if (!Number.isSafeInteger(points) || points < 1) {
    loyaltyPointsInput?.focus();
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
    status.textContent = `${translate("Points balance: ")}${number.format(data.points)}`;
    status.hidden = false;
    form.reset();
    await load();
  } catch {
    showToast(translate("Could not update points"), { type: "error" });
  } finally {
    if (button) button.disabled = false;
  }
});

const start = async () => {
  setContactsLoading(true);
  if (contactsLoadRetry) {
    contactsLoadRetry.hidden = true;
    contactsLoadRetry.disabled = true;
  }
  hideContactsError();
  try {
    if (!appShellReady) {
      await initAppShell({ activeNav });
      appShellReady = true;
    }
    await load();
  } catch {
    setContactsLoading(false);
    showContactsError();
  } finally {
    if (contactsLoadRetry) contactsLoadRetry.disabled = false;
  }
};

contactsLoadRetry?.addEventListener("click", () => {
  hideContactsError();
  void start();
});
void start();
