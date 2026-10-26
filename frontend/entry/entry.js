import { getBusiness, getMenuSettings, getSession, saveBusiness, saveMenuSettings } from "../shared/data/storage.js";

const SETUP_KEY = "food-system-initial-setup-complete";
const DEFAULT_TARGET = "/frontend/pages/app/dashboard/index.html";
const params = new URLSearchParams(window.location.search);
const target = params.get("next") || DEFAULT_TARGET;
const form = document.getElementById("firstRunForm");
const businessInput = document.getElementById("businessName");
const languageInput = document.getElementById("businessLanguage");
const error = document.getElementById("setupError");

const translations = {
  pt: {
    kicker: "GESTÃO DO SEU JEITO", headline: "Sua operação,<br /><span>mais leve</span>",
    intro: "Pedidos, produtos e rotina organizados em um só lugar",
    local: "Seus dados ficam salvos neste dispositivo", step: "Primeiros passos", title: "Configure seu comércio",
    description: "Informe o nome do seu comércio e escolha o idioma", businessLabel: "Nome do comércio", languageLabel: "Idioma",
    submit: "Configurar meu sistema",
    note: "Você pode alterar esses dados depois nas configurações",
    languageOptions: { pt: "Português", en: "Inglês" },
    placeholder: "Ex.: Café da Praça", error: "Não foi possível salvar a configuração Confira se o armazenamento local está disponível",
  },
  en: {
    kicker: "RUN YOUR BUSINESS YOUR WAY", headline: "A lighter way<br /><span>to run your business</span>",
    intro: "Orders, products and daily operations, all in one place",
    local: "Your details are saved on this device", step: "Getting started", title: "Set up your business",
    description: "Enter your business name and select a language", businessLabel: "Business name", languageLabel: "Language",
    submit: "Set up my system",
    note: "You can change these details later in settings",
    languageOptions: { pt: "Portuguese", en: "English" },
    placeholder: "e.g Market Street Café", error: "Could not save your setup Check that local storage is available",
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
  window.location.replace(new URL(target, window.location.href).href);
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
      window.location.assign(new URL(target, window.location.href).href);
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
