import { getLanguage } from "./i18n.js";

const localizedMessages = {
  "Automatic order stock deduction": {
    en: "Automatic order stock deduction",
    pt: "Baixa automática do pedido",
  },
  "Sale completed": {
    en: "Sale completed",
    pt: "Venda concluída",
  },
};

const legacyMessages = {
  "Baixa automática do pedido": "Automatic order stock deduction",
  "Venda concluída": "Sale completed",
};

export const localizeSystemMessage = (message) => {
  const englishMessage = legacyMessages[message] || message;
  const localized = localizedMessages[englishMessage];
  if (!localized) return message;
  return localized[getLanguage()] || localized.en;
};
