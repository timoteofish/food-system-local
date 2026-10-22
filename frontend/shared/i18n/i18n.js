const translations = {
  en: { inventory: "Inventory", operations: "Operations management", newIngredient: "New ingredient", name: "Name", unit: "Unit", quantity: "Quantity", minimumStock: "Minimum stock", register: "Register", registeredItems: "Registered ingredients", current: "Current", minimum: "Minimum", status: "Status", belowMinimum: "Below minimum", normal: "Normal", noItems: "No ingredients registered.", itemRegistered: "Ingredient registered.", language: "Language", portuguese: "Portuguese", english: "English", dashboard: "Dashboard", products: "Products", menu: "Menu", cashier: "Cash", orders: "Orders", team: "Team", kitchen: "Kitchen", reports: "Reports", contacts: "Contacts", backups: "Backups", tables: "Tables", fiscal: "Fiscal", profile: "Profile", closeApplication: "Close application", appLanguage: "App language" },
  pt: { inventory: "Estoque", operations: "Gestão operacional", newIngredient: "Novo insumo", name: "Nome", unit: "Unidade", quantity: "Quantidade", minimumStock: "Estoque mínimo", register: "Cadastrar", registeredItems: "Insumos cadastrados", current: "Atual", minimum: "Mínimo", status: "Status", belowMinimum: "Abaixo do mínimo", normal: "Normal", noItems: "Nenhum insumo cadastrado.", itemRegistered: "Insumo cadastrado.", language: "Idioma", portuguese: "Português", english: "Inglês", dashboard: "Painel", products: "Produtos", menu: "Cardápio", cashier: "Caixa", orders: "Pedidos", team: "Equipe", kitchen: "Cozinha", reports: "Relatórios", contacts: "Contatos", backups: "Backups", tables: "Mesas", fiscal: "Fiscal", profile: "Perfil", closeApplication: "Fechar aplicação", appLanguage: "Idioma do aplicativo" },
};

export const getLanguage = () => localStorage.getItem("food-system-language") || "pt";
export const setLanguage = (language) => { const next = translations[language] ? language : "pt"; localStorage.setItem("food-system-language", next); return next; };
export const translate = (key) => translations[getLanguage()]?.[key] || translations.en[key] || key;
export const applyTranslations = (root = document) => root.querySelectorAll("[data-i18n]").forEach((element) => { element.textContent = translate(element.dataset.i18n); });

const navigationKeys = ["dashboard", "products", "menu", "cashier", "orders", "team", "inventory", "kitchen", "reports", "contacts", "backups", "tables", "fiscal"];
const legacyTextPairs = {
  "Controle de caixa": "Cash control", "Movimentos do dia": "Today's movements", "Entradas": "Entries", "Saídas": "Withdrawals", "Saldo": "Balance", "Histórico": "History", "Movimentos": "Movements", "Pesquisar movimentações": "Search movements", "Produtos": "Products", "Cardápio": "Menu", "Caixa": "Cash", "Pedidos": "Orders", "Equipe": "Team", "Perfil": "Profile", "Configurar empresa": "Configure business", "Fechar aplicação": "Close application", "Gerenciar produtos": "Manage products", "Preço": "Price", "Descrição": "Description", "Salvar produto": "Save product", "Mesas ativas": "Active tables", "Pedidos hoje": "Orders today", "Itens no cardápio": "Menu items", "Pedidos em preparo": "Orders in preparation", "Pedidos prontos": "Ready orders", "Nenhum produto ativo no cardápio.": "No active products in the menu.", "Mesas rápidas": "Quick tables", "Configurar cardápio e QR": "Configure menu and QR", "Publicação rápida": "Quick publishing", "Clientes": "Customers", "Fornecedores": "Suppliers", "Relatórios": "Reports", "Backup": "Backup", "Restaurar": "Restore", "Cozinha": "Kitchen", "Operação por QR": "QR operation"
};
const translateLegacyText = (value) => {
  const normalized = value.trim();
  if (!normalized) return value;
  const pair = Object.entries(legacyTextPairs).find(([pt, en]) => getLanguage() === "en" ? normalized === pt : normalized === en);
  if (!pair) return value;
  const next = getLanguage() === "en" ? pair[1] : pair[0];
  return value.replace(normalized, next);
};
export const applyLegacyTranslations = (root = document) => {
  root.querySelectorAll(".menu-sidebar__nav a").forEach((link) => {
    const href = link.getAttribute("href") || "";
    const key = navigationKeys.find((item) => href.includes(`/${item}/`) || href.includes(`${item}/index.html`));
    if (!key) return;
    const label = link.querySelector(".menu-label");
    if (label) label.textContent = translate(key); else if (link.children.length === 0) link.textContent = translate(key);
    link.setAttribute("aria-label", translate(key));
  });
  root.querySelectorAll(".profile-label").forEach((element) => { element.textContent = translate("profile"); });
  root.querySelectorAll("[data-action='close-app']").forEach((element) => { element.textContent = translate("closeApplication"); });
  const walker = root.createTreeWalker(root.body || root, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (node.parentElement?.closest("script,style,select,option")) continue;
    node.nodeValue = translateLegacyText(node.nodeValue);
  }
  root.querySelectorAll("input[placeholder], textarea[placeholder], [aria-label], [title]").forEach((element) => {
    ["placeholder", "aria-label", "title"].forEach((attribute) => { if (element.hasAttribute(attribute)) element.setAttribute(attribute, translateLegacyText(element.getAttribute(attribute))); });
  });
  applyTranslations(root);
};

export const installLanguageSelector = (root = document) => {
  if (root.getElementById?.("globalLanguageSelect")) return;
  const host = root.querySelector(".menu-content") || root.querySelector(".menu-sidebar__profile") || root.querySelector(".menu-sidebar");
  if (!host) return;
  const wrapper = root.createElement("label");
  wrapper.className = "global-language-control";
  wrapper.innerHTML = `<span>${translate("appLanguage")}</span><select id="globalLanguageSelect" aria-label="${translate("language")}"><option value="pt">${translate("portuguese")}</option><option value="en">${translate("english")}</option></select>`;
  const select = wrapper.querySelector("select");
  select.value = getLanguage();
  select.addEventListener("change", () => { setLanguage(select.value); applyLegacyTranslations(root); wrapper.querySelector("span").textContent = translate("appLanguage"); });
  host.appendChild(wrapper);
};
