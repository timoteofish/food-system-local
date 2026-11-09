import portugueseTranslations from "./locales/pt.js";
import legacyTextPairs from "./locales/legacy-text-pairs.js";
import legacyDynamicRules from "./locales/legacy-dynamic-rules.js";

const translations = { pt: portugueseTranslations };
const portugueseToEnglish = new Map(Object.entries(legacyTextPairs));
const englishToPortuguese = new Map();

for (const [portuguese, english] of portugueseToEnglish) {
  if (!englishToPortuguese.has(english)) englishToPortuguese.set(english, portuguese);
}

export const getLanguage = () => {
  return "pt";
};

export const getLocale = () => "pt-BR";

export const setLanguage = () => {
  const next = "pt";
  try {
    localStorage.setItem("food-system-language", next);
  } catch {
    // Keep the interface usable when browser storage is unavailable.
  }
  return next;
};

export const translate = (key) =>
  translations.pt[key] || translateLegacyText(key);

export const applyTranslations = (root = document) => {
  root.querySelectorAll("[data-i18n]").forEach((element) => {
    const next = translate(element.dataset.i18n);
    if (element.textContent !== next) element.textContent = next;
  });
};

const navigationKeys = [
  "dashboard",
  "products",
  "menu",
  "cashier",
  "orders",
  "team",
  "inventory",
  "kitchen",
  "reports",
  "delivery",
  "backups",
  "fiscal",
  "integrations",
];

const translateLegacyText = (value) => {
  const language = getLanguage();
  const exactTranslation = language === "en"
    ? portugueseToEnglish.get(value)
    : englishToPortuguese.get(value);
  if (exactTranslation !== undefined) return exactTranslation;

  const normalized = value.trim();
  if (!normalized) return value;
  const dynamicRules = legacyDynamicRules[language] || [];
  for (const rule of dynamicRules) {
    const match = normalized.match(rule.pattern);
    if (!match) continue;
    const translated = rule.replacement.replace(/\$(\d+)/g, (placeholder, index) => {
      const capturedValue = match[index];
      const mappedValue = rule.captureMaps?.[index]?.[capturedValue];
      return mappedValue ?? capturedValue ?? placeholder;
    });
    return value.replace(normalized, translated);
  }

  const translatedText = language === "en"
    ? portugueseToEnglish.get(normalized)
    : englishToPortuguese.get(normalized);
  return translatedText === undefined ? value : value.replace(normalized, translatedText);
};

export const getLegacyTranslationCandidates = (value, language) => {
  const normalizedLanguage = language === "pt" ? "pt" : "en";
  return Object.entries(legacyTextPairs)
    .filter(([portuguese, english]) => value === portuguese || value === english)
    .map(([portuguese, english]) => normalizedLanguage === "pt" ? portuguese : english);
};

const isMerchantContent = (element) => Boolean(element?.closest(
  "[data-merchant-content], [data-business-content], .merchant-content, .business-content, #customerBusinessName, #customerMenuBanner, #customerMenuSubtitle, #customerCategories, #customerTableDisplay, #customerMenuBagCount, #customerBagTotal, #customerDeliveryFeeTotal, .menu-item img, .bag-panel__item-thumb, .bag-panel__item-name, .bag-panel__item-meta, [data-product-name], [data-product-description], [data-business-name], [data-menu-copy]"
));

const shouldTranslateAttribute = (element, attribute) => {
  if (attribute === "value" && (element.matches("input,textarea,select") || element.isContentEditable)) return false;
  return !isMerchantContent(element);
};

export const applyLegacyTranslations = (root = document) => {
  root.documentElement && (root.documentElement.lang = "pt-BR");
  if (root === document && document.title) {
    const nextTitle = translateLegacyText(document.title);
    if (document.title !== nextTitle) document.title = nextTitle;
  }
  root.querySelectorAll(".menu-sidebar__nav a").forEach((link) => {
    const href = link.getAttribute("href") || "";
    const key = navigationKeys.find((item) => href.includes(`/${item}/`) || href.includes(`${item}/index.html`));
    if (!key) return;

    const label = link.querySelector(".menu-label");
    if (label && label.textContent !== translate(key)) label.textContent = translate(key);
    else if (!label && link.children.length === 0 && link.textContent !== translate(key)) link.textContent = translate(key);
    if (link.getAttribute("aria-label") !== translate(key)) link.setAttribute("aria-label", translate(key));
  });

  root.querySelectorAll(".profile-label").forEach((element) => {
    if (element.textContent !== translate("profile")) element.textContent = translate("profile");
  });
  root.querySelectorAll("[data-action='close-app']").forEach((element) => {
    if (element.textContent !== translate("closeApplication")) element.textContent = translate("closeApplication");
  });

  const documentRoot = root.nodeType === Node.DOCUMENT_NODE ? root : root.ownerDocument;
  const walker = documentRoot.createTreeWalker(root.nodeType === Node.DOCUMENT_NODE ? root.body || root : root, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (node.parentElement?.closest("script,style")) continue;
    if (isMerchantContent(node.parentElement)) continue;
    const next = translateLegacyText(node.nodeValue);
    if (next !== node.nodeValue) node.nodeValue = next;
  }

  root.querySelectorAll("input[placeholder], textarea[placeholder], [aria-label], [title], option, input[value], button[value]").forEach((element) => {
    ["placeholder", "aria-label", "title", "value"].forEach((attribute) => {
      if (element.hasAttribute(attribute)) {
        const current = element.getAttribute(attribute);
        const next = shouldTranslateAttribute(element, attribute) ? translateLegacyText(current) : current;
        if (next !== current) element.setAttribute(attribute, next);
      }
    });
  });

  applyTranslations(root);
};

if (typeof document !== "undefined" && typeof MutationObserver !== "undefined" && !window.__foodSystemI18nObserver) {
  window.__foodSystemI18nObserver = new MutationObserver((records) => {
    if (!records.length || window.__foodSystemI18nScheduled) return;
    window.__foodSystemI18nScheduled = true;
    queueMicrotask(() => {
      window.__foodSystemI18nScheduled = false;
      applyLegacyTranslations(document);
    });
  });
  window.__foodSystemI18nObserver.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
      attributeFilter: ["aria-label", "title", "placeholder", "value"],
  });
}

