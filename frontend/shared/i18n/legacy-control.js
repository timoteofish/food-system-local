import { applyLegacyTranslations, getLanguage, setLanguage } from "./i18n.js";

const initializeLegacyLanguageControls = () => {
  if (!document.querySelector("[data-global-language]")) {
    const host = document.querySelector(".menu-content") || document.querySelector("main.content");
    if (host) {
      const wrapper = document.createElement("label");
      wrapper.className = "global-language-control";
      wrapper.innerHTML = `<span>Language</span><select data-global-language aria-label="Language"><option value="pt">Português</option><option value="en">English</option></select>`;
      host.prepend(wrapper);
    }
  }
  document.querySelectorAll("[data-global-language]").forEach((select) => {
    select.value = getLanguage();
    if (select.dataset.languageBound === "true") return;
    select.dataset.languageBound = "true";
    select.addEventListener("change", () => { setLanguage(select.value); window.location.reload(); });
  });
  applyLegacyTranslations(document);
};

initializeLegacyLanguageControls();
