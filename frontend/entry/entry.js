import { getBusiness, getMenuSettings, saveBusiness, saveMenuSettings } from "../shared/data/storage.js";
import { pingApi, provisionLocalBusiness } from "../shared/api/client.js";
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
const languageInput = document.getElementById("businessLanguage");
const error = document.getElementById("setupError");

const applyLanguage = (language) => {
  const copy = translations[language] || translations.en;
  document.documentElement.lang = language === "en" ? "en" : "pt-BR";
  document.querySelector(".first-run")?.setAttribute(
    "aria-label",
    copy.ariaLabel
  );
  languageInput.setAttribute("aria-label", copy.languageLabel);
  languageInput.querySelector('[value="pt"]').textContent = copy.languageOptions.pt;
  languageInput.querySelector('[value="en"]').textContent = copy.languageOptions.en;
  document.querySelectorAll("[data-copy]").forEach((element) => {
    const value = copy[element.dataset.copy];
    if (value?.includes("<br")) element.innerHTML = value.replace(/<(?!br\s*\/?>)[^>]*>/gi, "");
    else if (value) element.textContent = value;
  });
  businessInput.placeholder = copy.placeholder;
  if (!error.hidden) error.textContent = copy.error;
  document.title = copy.documentTitle;
};

const getSavedLanguage = () => {
  try {
    const saved = localStorage.getItem("food-system-language");
    return saved === "en" ? "en" : "pt";
  } catch {
    return "pt";
  }
};

let language = getSavedLanguage();
languageInput.value = language;
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

  languageInput.addEventListener("change", () => {
    language = languageInput.value === "en" ? "en" : "pt";
    applyLanguage(language);
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    language = languageInput.value === "en" ? "en" : "pt";
    const name = businessInput.value.trim();
    if (name.length < 2 || name.length > 160) {
      businessInput.focus();
      error.textContent = (translations[language] || translations.en).nameError;
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
      error.textContent = (translations[language] || translations.en).error;
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
