import { getBusiness, getMenuSettings, saveBusiness, saveMenuSettings } from "../shared/data/storage.js";

const SETUP_KEY = "food-system-initial-setup-complete";
const DEFAULT_TARGET = "/frontend/pages/app/dashboard/index.html";
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

const translations = {
  pt: {
    headline: "Organize seu<br />restaurante",
    intro: "Pedidos, cardápio e operação em um só lugar",
    title: "Configure seu negócio",
    description: "Informe o nome do seu negócio e escolha o idioma", businessLabel: "Nome do negócio", languageLabel: "Idioma",
    submit: "Continuar",
    note: "Você poderá alterar essas informações nas configurações",
    languageOptions: { pt: "Português", en: "Inglês" },
    placeholder: "Ex.: Café da Praça", error: "Não foi possível salvar as informações, tente novamente",
  },
  en: {
    headline: "Organize your<br />restaurant",
    intro: "Orders, menu and operations in one place",
    title: "Set up your business",
    description: "Enter your business name and choose a language", businessLabel: "Business name", languageLabel: "Language",
    submit: "Continue",
    note: "You can change this information later in settings",
    languageOptions: { pt: "Portuguese", en: "English" },
    placeholder: "e.g. Market Street Café", error: "Could not save your information, please try again",
  },
};

const applyLanguage = (language) => {
  const copy = translations[language] || translations.en;
  document.documentElement.lang = language === "en" ? "en" : "pt-BR";
  document.querySelector(".first-run")?.setAttribute(
    "aria-label",
    language === "en" ? "Initial Food System setup" : "Configuração inicial do Food System"
  );
  languageInput.setAttribute("aria-label", copy.languageLabel);
  languageInput.querySelector('[value="pt"]').textContent = copy.languageOptions.pt;
  languageInput.querySelector('[value="en"]').textContent = copy.languageOptions.en;
  document.querySelectorAll("[data-copy]").forEach((element) => {
    const value = copy[element.dataset.copy];
    if (value?.includes("<br")) element.innerHTML = value;
    else if (value) element.textContent = value;
  });
  businessInput.placeholder = copy.placeholder;
  if (!error.hidden) error.textContent = copy.error;
  document.title = language === "en" ? "Welcome · Food System" : "Boas-vindas · Food System";
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

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    language = languageInput.value === "en" ? "en" : "pt";
    const name = businessInput.value.trim();
    if (!name) {
      businessInput.focus();
      return;
    }
    const keysToRestore = [SETUP_KEY, "food-system-business", "food-system-menu-settings", "food-system-language"];
    let previousValues = null;
    const submitButton = form.querySelector('[type="submit"]');
    submitButton.disabled = true;
    try {
      previousValues = Object.fromEntries(keysToRestore.map((key) => [key, localStorage.getItem(key)]));
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
      submitButton.disabled = false;
    }
  });
}
