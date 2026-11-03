import { applyLegacyTranslations, getLanguage, setLanguage } from "./i18n.js";

const initializeLegacyLanguageControls = () => {
  const isSettings = /\/user-edit\//.test(location.pathname);
  document.querySelectorAll(".global-language-control, #languageSelect, [data-global-language]").forEach((control) => {
    if (!isSettings) (control.closest("label") || control).remove();
  });
  if (isSettings && !document.querySelector("[data-global-language]")) {
    const host = document.querySelector(".user-edit-card__header");
    if (host) {
      const wrapper = document.createElement("label");
      wrapper.className = "global-language-control";
      wrapper.innerHTML = `<span>Language</span><select data-global-language aria-label="Language"><option value="en">English</option><option value="pt">Portuguese</option></select>`;
      host.append(wrapper);
    }
  }
  document.querySelectorAll("[data-global-language]").forEach((select) => {
    select.value = getLanguage();
    if (select.dataset.languageBound === "true") return;
    select.dataset.languageBound = "true";
    select.addEventListener("change", () => { setLanguage(select.value); window.location.reload(); });
  });
  document.documentElement.lang = getLanguage() === "en" ? "en" : "pt-BR";
  applyLegacyTranslations(document);
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeLegacyLanguageControls, { once: true });
} else {
  initializeLegacyLanguageControls();
}
