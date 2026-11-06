import { getBusiness, getMenuSettings, saveBusiness, saveMenuSettings } from "../shared/data/storage.js";
import { pingApi, provisionLocalBusiness } from "../shared/api/client.js";
import { TERMS_SECTIONS } from "../pages/auth/terms/terms-data.js";
import { translate } from "../shared/i18n/i18n.js";
import translations from "./translations.js";

const SETUP_KEY = "food-system-initial-setup-complete";
const DEFAULT_TARGET = "/pages/app/dashboard/index.html";
const params = new URLSearchParams(window.location.search);
const requestedTarget = params.get("next") || DEFAULT_TARGET;
const targetUrl = (() => {
  try {
    const candidate = new URL(requestedTarget, window.location.href);
    if (candidate.origin === window.location.origin && /\/pages\/app\/[a-z-]+\/index\.html$/.test(candidate.pathname)) return candidate;
  } catch {
    // Fall back to the local dashboard when the continuation URL is malformed.
  }
  return new URL(DEFAULT_TARGET, window.location.href);
})();
const form = document.getElementById("firstRunForm");
const businessInput = document.getElementById("businessName");
const error = document.getElementById("setupError");
const termsModal = document.getElementById("termsModal");
const termsBody = document.getElementById("setupTermsBody");
const openTerms = document.getElementById("openTerms");
const termsAgreement = document.getElementById("termsAgreement");

const applyLanguage = () => {
  const copy = translations.pt;
  document.documentElement.lang = "pt-BR";
  document.querySelector(".first-run")?.setAttribute(
    "aria-label",
    copy.ariaLabel
  );
  document.querySelectorAll("[data-copy]").forEach((element) => {
    const value = copy[element.dataset.copy];
    if (value?.includes("<br")) element.innerHTML = value.replace(/<(?!br\s*\/?>)[^>]*>/gi, "");
    else if (value) element.textContent = value;
  });
  termsModal.querySelectorAll("[aria-label]").forEach((element) => {
    element.setAttribute("aria-label", copy.closeTerms);
  });
  businessInput.placeholder = copy.placeholder;
  if (!error.hidden) error.textContent = copy.error;
  document.title = copy.documentTitle;
  if (termsBody) {
    termsBody.innerHTML = TERMS_SECTIONS.map((section) => `
      <section class="first-run__terms-section">
        <h3>${translate(section.title)}</h3>
        <ul>${section.items.map((item) => `<li>${translate(item)}</li>`).join("")}</ul>
      </section>
    `).join("");
  }
};

const language = "pt";
let business = {};
let hasExistingSetup = false;
try {
  business = getBusiness();
  const setupWasMarkedComplete = localStorage.getItem(SETUP_KEY) === "true";
  // Existing installations with a business name keep their current dashboard flow.
  hasExistingSetup = setupWasMarkedComplete || Boolean(business.name);
} catch {
  // The form remains available when browser storage is disabled.
}

if (hasExistingSetup) {
  window.location.replace(targetUrl.href);
} else {
  applyLanguage(language);

  const closeTerms = () => {
    termsModal.hidden = true;
    openTerms.focus();
  };

  openTerms.addEventListener("click", () => {
    termsModal.hidden = false;
    termsModal.querySelector(".first-run__terms-close").focus();
  });
  termsModal.addEventListener("click", (event) => {
    if (event.target.closest("[data-close-terms]")) closeTerms();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !termsModal.hidden) closeTerms();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!termsAgreement.checked) {
      termsAgreement.focus();
      return;
    }
    const name = businessInput.value.trim();
    if (name.length < 2 || name.length > 160) {
      businessInput.focus();
      error.textContent = translations.pt.nameError;
      error.hidden = false;
      return;
    }
    error.hidden = true;
    const keysToRestore = [SETUP_KEY, "food-system-business", "food-system-menu-settings", "food-system-language"];
    let previousValues = null;
    const submitButton = form.querySelector('[type="submit"]');
    submitButton.disabled = true;
    try {
      previousValues = Object.fromEntries(keysToRestore.map((key) => [key, localStorage.getItem(key)]));
      if (await pingApi()) await provisionLocalBusiness(name);
      business = { ...business, name };
      saveBusiness(business);
      saveMenuSettings({ ...getMenuSettings(), businessName: name });
      localStorage.setItem("food-system-language", language);
      localStorage.setItem(SETUP_KEY, "true");
      window.location.assign(targetUrl.href);
    } catch {
      error.textContent = translations.pt.error;
      error.hidden = false;
      error.focus();
      Object.entries(previousValues || {}).forEach(([key, value]) => {
        try {
          if (value === null) localStorage.removeItem(key);
          else localStorage.setItem(key, value);
        } catch {
          // Preserve the original save error when storage also blocks rollback.
        }
      });
    } finally {
      if (!error.hidden) submitButton.disabled = false;
    }
  });
}
