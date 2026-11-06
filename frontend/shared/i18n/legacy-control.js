import { applyLegacyTranslations } from "./i18n.js";
import "../ui/input-constraints.js";

const initializeLegacyLanguageControls = () => {
  document.querySelectorAll(".global-language-control, #languageSelect, [data-global-language]").forEach((control) => {
    (control.closest("label") || control).remove();
  });
  document.documentElement.lang = "pt-BR";
  applyLegacyTranslations(document);
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeLegacyLanguageControls, { once: true });
} else {
  initializeLegacyLanguageControls();
}
