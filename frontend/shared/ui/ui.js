import { getBusiness, getMenuSettings, getSession, saveBusiness, setSession } from "../data/storage.js";
import { bootstrapApi, completeBusinessOnboarding, logout, requireAuth, saveMenuSettingsRemote } from "../auth/auth.js";
import { checkForSystemUpdates } from "../auth/auth.js";
import { escapeHtml } from "../utils/utils.js";
import { applyLegacyTranslations, getLanguage, setLanguage, translate } from "../i18n/i18n.js";

export { requireAuth };

const closeApplication = () => {
  const tauriWindow = window.__TAURI__?.window?.getCurrentWindow?.();
  if (tauriWindow) {
    void tauriWindow.close();
  } else {
    window.close();
  }
};

const APP_NAVIGATION = [
  ["dashboard", "Painel", "M4 11.2 12 4l8 7.2V20a1 1 0 0 1-1 1h-4.5v-6.2h-5V21H5a1 1 0 0 1-1-1v-8.8z"],
  ["inventory", "Estoque", "m12 3 9 5v8l-9 5-9-5V8zm0 10 9-5m-9 5-9-5m9 5v8"],
  ["orders", "Pedidos", "M7 3h8l4 4v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm7 2v3h3M8 12h8M8 16h8"],
  ["kitchen", "Cozinha", "M4 13h16a8 8 0 0 1-16 0zm2-3a6 6 0 0 1 12 0M12 4v2"],
  ["tables", "Mesas", "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"],
  ["cashier", "Caixa", "M5 8h14l-1 12H6L5 8zm3 0 1-4h6l1 4M9 12v4m6-4v4"],
  ["delivery", "Entregas", "M3 7h11v10H3zM14 10h4l3 3v4h-7zM7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm11 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"],
  ["products", "Produtos", "M4 4h7v7H4zM13 4h7v4h-7zM4 13h7v7H4zM13 10h7v10h-7z"],
  ["menu", "Cardápio", "M5 6h14M5 12h14M5 18h9"],
  ["contacts", "Clientes", "M16 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1m7-9a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm6-7a4 4 0 0 1 0 7m2 4a4 4 0 0 1 3 4v1"],
  ["team", "Equipe", "M16 11a4 4 0 1 0-3.5-6M8 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm-7 8v-2a7 7 0 0 1 14 0v2zm15-7a5 5 0 0 1 5 5v2h-3"],
  ["reports", "Relatórios", "M4 20V10m5 10V4m5 16v-7m5 7V7"],
  ["fiscal", "Fiscal", "M6 3h8l4 4v14H6zM14 3v5h5M9 13h6m-6 4h6"],
  ["integrations", "Integrações", "M9 7V4m6 3V4M8 7h8v4a4 4 0 0 1-8 0zm4 8v5m-5 0h10"],
  ["backups", "Backups", "M4 7h16v13H4zM3 4h18M9 11h6m-6 4h6"],
];
const APP_NAVIGATION_GROUPS = [
  APP_NAVIGATION.slice(0, 6),
  APP_NAVIGATION.slice(6, 11),
  APP_NAVIGATION.slice(11),
];

const ensureCanonicalSidebarNavigation = (activePage) => {
  const nav = document.querySelector(".menu-sidebar__nav");
  if (!nav) return null;

  const fragment = document.createDocumentFragment();
  APP_NAVIGATION_GROUPS.forEach((group) => {
    const section = document.createElement("div");
    section.className = "menu-sidebar__nav-group";

    group.forEach(([page, label, path]) => {
      const translatedLabel = translate(label);
      const link = document.createElement("a");
      link.href = new URL(`../../pages/app/${page}/index.html`, import.meta.url).href;
      link.setAttribute("aria-label", translatedLabel);
      link.title = translatedLabel;
      if (page === activePage) {
        link.classList.add("active");
        link.setAttribute("aria-current", "page");
      }

      const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      icon.setAttribute("class", "menu-icon");
      icon.setAttribute("viewBox", "0 0 24 24");
      icon.setAttribute("aria-hidden", "true");
      icon.setAttribute("focusable", "false");
      const shape = document.createElementNS("http://www.w3.org/2000/svg", "path");
      shape.setAttribute("d", path);
      shape.setAttribute("fill", "none");
      shape.setAttribute("stroke", "currentColor");
      shape.setAttribute("stroke-width", "1.8");
      shape.setAttribute("stroke-linecap", "round");
      shape.setAttribute("stroke-linejoin", "round");
      icon.append(shape);

      const text = document.createElement("span");
      text.className = "menu-label";
      text.textContent = translatedLabel;
      link.append(icon, text);
      section.append(link);
    });

    fragment.append(section);
  });

  nav.replaceChildren(fragment);
  return nav;
};

const ensureBusinessOnboarding = () => {
  const session = getSession();
  if (!session?.needsOnboarding) return;

  let backdrop = document.getElementById("businessOnboardingBackdrop");
  let panel = document.getElementById("businessOnboardingPanel");

  if (!backdrop || !panel) {
    backdrop = document.createElement("div");
    backdrop.id = "businessOnboardingBackdrop";
    backdrop.className = "business-onboarding-backdrop";

    panel = document.createElement("aside");
    panel.id = "businessOnboardingPanel";
    panel.className = "business-onboarding-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", translate("Boas-vindas ao Food System"));
    panel.innerHTML = `
      <div class="business-onboarding-panel__hero">
        <p class="business-onboarding-panel__eyebrow">Primeiro acesso</p>
        <h2>Vamos configurar seu comércio</h2>
        <p>Informe os dados básicos para preparar o sistema para sua operação</p>
      </div>
      <form class="business-onboarding-panel__form" data-business-onboarding-form>
        <div class="business-onboarding-panel__grid">
          <label class="field">
            <span>Nome do comércio</span>
            <input name="businessName" type="text" autocomplete="organization" placeholder="Ex.: Pizzaria Central" required />
          </label>
          <label class="field">
            <span>Tipo de negócio</span>
            <select name="businessType" required>
              <option value="">Selecione</option>
              <option value="Restaurante">Restaurante</option>
              <option value="Lanchonete">Lanchonete</option>
              <option value="Pizzaria">Pizzaria</option>
              <option value="Hamburgueria">Hamburgueria</option>
              <option value="Cafeteria">Cafeteria</option>
            </select>
          </label>
          <label class="field">
            <span>Modelo de atendimento</span>
            <select name="serviceModel" required>
              <option value="">Selecione</option>
              <option value="Mesas no salao">Mesas no salão</option>
              <option value="Balcao e retirada">Balcão e retirada</option>
              <option value="Delivery e retirada">Delivery e retirada</option>
              <option value="Misto">Misto</option>
            </select>
          </label>
          <label class="field">
            <span>Telefone</span>
            <input name="phone" type="tel" autocomplete="tel" placeholder="(00) 00000-0000" />
          </label>
          <label class="field field-wide">
            <span>Cidade</span>
            <input name="city" type="text" autocomplete="address-level2" placeholder="Ex.: Salvador" required />
          </label>
        </div>
        <p class="business-onboarding-panel__feedback" data-business-onboarding-feedback hidden></p>
        <button class="btn btn--primary" type="submit" data-business-onboarding-submit>Salvar e continuar</button>
      </form>
    `;

    document.body.append(backdrop, panel);
  }

  const form = panel.querySelector("[data-business-onboarding-form]");
  const feedback = panel.querySelector("[data-business-onboarding-feedback]");
  const submit = panel.querySelector("[data-business-onboarding-submit]");
  const business = getBusiness();

  if (form && !form.dataset.prefilled) {
    const businessNameInput = form.elements.namedItem("businessName");
    const businessTypeInput = form.elements.namedItem("businessType");
    const serviceModelInput = form.elements.namedItem("serviceModel");
    const phoneInput = form.elements.namedItem("phone");
    const cityInput = form.elements.namedItem("city");

    if (businessNameInput) businessNameInput.value = business.name || session.name || "";
    if (businessTypeInput) businessTypeInput.value = business.businessType || "";
    if (serviceModelInput) serviceModelInput.value = business.serviceModel || "";
    if (phoneInput) phoneInput.value = business.phone || "";
    if (cityInput) cityInput.value = business.city || "";
    form.dataset.prefilled = "true";
  }

  backdrop.hidden = false;
  panel.hidden = false;
  requestAnimationFrame(() => {
    backdrop.classList.add("is-open");
    panel.classList.add("is-open");
  });
  document.body.classList.add("modal-open");

  if (form && form.dataset.bound !== "true") {
    form.dataset.bound = "true";
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (form.dataset.submitting === "true") return;

      const formData = new FormData(form);
      const payload = {
        businessName: String(formData.get("businessName") || "").trim(),
        businessType: String(formData.get("businessType") || "").trim(),
        serviceModel: String(formData.get("serviceModel") || "").trim(),
        phone: String(formData.get("phone") || "").trim(),
        city: String(formData.get("city") || "").trim(),
      };

      form.dataset.submitting = "true";
      submit.disabled = true;
      feedback.hidden = false;
      feedback.className = "business-onboarding-panel__feedback";
      feedback.textContent = translate("Salvando");

      try {
        await completeBusinessOnboarding(payload);
        backdrop.classList.remove("is-open");
        panel.classList.remove("is-open");
        document.body.classList.remove("modal-open");
        setTimeout(() => {
          backdrop.hidden = true;
          panel.hidden = true;
        }, 220);
        window.location.reload();
      } catch (error) {
        feedback.className = "business-onboarding-panel__feedback business-onboarding-panel__feedback--error";
        feedback.textContent = translate(error?.message || "Não foi possível salvar a configuração inicial");
      } finally {
        submit.disabled = false;
        form.dataset.submitting = "false";
      }
    });
  }
};

const applySidebarInlineState = (collapsed) => {
  const shell = document.querySelector(".menu-shell");
  const brand = document.querySelector(".menu-sidebar__brand");
  const brandRow = document.querySelector(".menu-sidebar__brand-row");
  const nav = document.querySelector(".menu-sidebar__nav");
  const navLinks = nav?.querySelectorAll("a") || [];
  const labels = document.querySelectorAll(".menu-label");
  const profile = document.querySelector(".menu-sidebar__profile");
  const profileLabel = document.querySelector(".menu-sidebar__profile .profile-label");
  const content = document.querySelector(".menu-content");

  if (shell) {
    shell.dataset.sidebarState = collapsed ? "collapsed" : "expanded";
  }

  if (brand) {
    const hideBrand = collapsed;
    brand.style.maxWidth = hideBrand ? "0" : "";
    brand.style.opacity = hideBrand ? "0" : "";
    brand.style.transform = hideBrand ? "translateX(-10px)" : "";
    brand.style.pointerEvents = hideBrand ? "none" : "";
  }

  if (brandRow) {
    const compactBrandRow = collapsed;
    brandRow.style.justifyContent = compactBrandRow ? "center" : "";
    brandRow.style.padding = compactBrandRow ? "0" : "";
    brandRow.style.gap = compactBrandRow ? "0" : "";
  }

  navLinks.forEach((link) => {
    const compactLink = collapsed;
    link.style.justifyContent = compactLink ? "center" : "";
    link.style.padding = compactLink ? "12px 0" : "";
    link.style.gap = compactLink ? "0" : "";
  });

  labels.forEach((label) => {
    const hideLabel = collapsed;
    label.style.maxWidth = hideLabel ? "0" : "";
    label.style.opacity = hideLabel ? "0" : "";
    label.style.transform = hideLabel ? "translateX(-10px)" : "";
    label.style.pointerEvents = hideLabel ? "none" : "";
  });

  if (profile) {
    profile.style.alignSelf = collapsed ? "center" : "";
    profile.style.justifyContent = collapsed ? "center" : "";
  }

  if (profileLabel) {
    profileLabel.style.display = collapsed ? "none" : "";
  }

  if (content) {
    content.style.marginLeft = "0";
  }
};

const setSidebarCollapsedState = (collapsed) => {
  document.body.classList.toggle("menu-sidebar-collapsed", collapsed);
  document.documentElement.classList.toggle("menu-sidebar-collapsed", collapsed);

  const shell = document.querySelector(".menu-shell");
  if (shell) {
    shell.classList.toggle("menu-sidebar-collapsed", collapsed);
  }

  applySidebarInlineState(collapsed);
  document.documentElement.dataset.sidebarReady = "true";
};

const getStoredSidebarCollapsedState = () => {
  return window.matchMedia("(max-width: 1023px)").matches;
};

export const initProfileMenu = () => {
  const profile = document.querySelector(".profile");
  if (!profile) return;

  const button = profile.querySelector(".profile-btn");
  if (!button) return;

  let session = getSession();
  let business = getBusiness();
  let displayName = session?.name || business.name || "Usuário";
  const clientCategory = "Aplicação local";
  let clientEmail = session?.email || business.email || "";
  const clientPhone = business.phone || session?.phone || "";
  const clientAvatar = session?.avatar || business.avatar || "";
  const displayPlan = clientCategory;
  let backdrop = document.getElementById("userEditBackdrop");
  let panel = document.getElementById("userEditPanel");

  if (!backdrop || !panel) {
    backdrop = document.createElement("div");
    backdrop.id = "userEditBackdrop";
    backdrop.className = "user-edit-backdrop";
    backdrop.hidden = true;

    panel = document.createElement("aside");
    panel.id = "userEditPanel";
    panel.className = "user-edit-panel";
    panel.hidden = true;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", translate("Configurações do usuário"));
    panel.innerHTML = `
      <div class="user-edit-panel__hero">
        <button type="button" class="user-edit-panel__close" data-user-edit-close aria-label="Fechar painel">×</button>
        <div class="user-edit-panel__hero-user">
          <div class="user-edit-panel__avatar" aria-hidden="true">${escapeHtml(displayName.slice(0, 1).toUpperCase())}</div>
          <div class="user-edit-panel__hero-copy">
            <strong data-merchant-content>${escapeHtml(displayName)}</strong>
            <span>${escapeHtml(displayPlan)}</span>
            <small class="user-edit-panel__hero-email" data-merchant-content ${clientEmail ? "" : "hidden"}>${escapeHtml(clientEmail)}</small>
          </div>
        </div>
      </div>
      <div class="user-edit-panel__body">
        <div class="user-edit-panel__views">
          <section class="user-edit-panel__view is-current" data-profile-view="home">
            <div class="user-edit-panel__actions-stack">
              <div class="user-edit-panel__home-intro"><span>SUA CONTA</span><h2>Perfil e aplicativo</h2><p>Gerencie seus dados, atualizações e suporte</p></div>
              <button class="user-edit-panel__action user-edit-panel__action--menu" type="button" data-profile-open="settings"><span class="user-edit-panel__action-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-4.42 0-8 2.24-8 5v1h16v-1c0-2.76-3.58-5-8-5Z"/></svg></span><span><strong>Configurações da conta</strong><small>Atualize seu perfil e os dados do comércio</small></span><span class="user-edit-panel__action-chevron" aria-hidden="true">›</span></button>
              <button class="user-edit-panel__action user-edit-panel__action--menu" type="button" data-profile-open="updates"><span class="user-edit-panel__action-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M20 7v5h-5M4.7 9A7.5 7.5 0 0 1 18 6l2 2M4 17v-5h5m10.3 3A7.5 7.5 0 0 1 6 18l-2-2"/></svg></span><span><strong>Atualizações do sistema</strong><small>Verifique a versão instalada</small></span><span class="user-edit-panel__action-chevron" aria-hidden="true">›</span></button>
              <button class="user-edit-panel__action user-edit-panel__action--menu" type="button" data-profile-open="support"><span class="user-edit-panel__action-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-4v.01M9.6 9a2.4 2.4 0 1 1 4.35 1.42c-.95 1.05-1.95 1.26-1.95 2.83"/></svg></span><span><strong>Fale com o suporte</strong><small>Envie uma mensagem para nossa equipe</small></span><span class="user-edit-panel__action-chevron" aria-hidden="true">›</span></button>
              <button class="user-edit-panel__action user-edit-panel__action--danger" type="button" data-action="close-app">Fechar aplicativo</button>
            </div>
          </section>
          <section class="user-edit-panel__view" data-profile-view="settings" hidden>
            <div class="user-edit-panel__page-head">
              <span>Central da conta</span>
              <strong>Dados do perfil</strong>
            </div>
            <div class="user-edit-panel__page-shell">
              <section class="user-edit-panel__settings-shell">
                <aside class="user-edit-panel__settings-side">
                  <div class="user-edit-panel__settings-avatar">
                    <div class="user-edit-panel__settings-avatar-frame">
                      <img class="user-edit-panel__settings-avatar-image" alt="Foto do usuário" ${clientAvatar ? `src="${escapeHtml(clientAvatar)}"` : "hidden"} />
                      <span class="user-edit-panel__settings-avatar-placeholder" ${clientAvatar ? "hidden" : ""}>${displayName.slice(0, 1).toUpperCase()}</span>
                    </div>
                    <div class="user-edit-panel__settings-avatar-copy">
                      <strong>Imagem do perfil</strong>
                      <small>Atualize sua foto e os dados da conta</small>
                    </div>
                    <input class="user-edit-panel__file-input" type="file" accept="image/*" hidden />
                    <button class="user-edit-panel__action user-edit-panel__action--ghost" type="button" data-settings-avatar>Alterar foto</button>
                  </div>
                  <div class="user-edit-panel__settings-summary">
                    <article class="user-edit-panel__card">
                      <span>Aplicativo instalado</span>
                      <strong>Food System</strong>
                      <small>Operação local neste computador</small>
                    </article>
                    <button class="user-edit-panel__action user-edit-panel__action--ghost" type="button" data-profile-open="updates">Verificar atualizações</button>
                  </div>
                </aside>
                <form class="user-edit-panel__settings-form" data-settings-form>
                  <section class="user-edit-panel__settings-block">
                    <div class="user-edit-panel__settings-block-head">
                      <span>Conta</span>
                      <strong>Dados principais</strong>
                    </div>
                    <div class="user-edit-panel__settings-grid">
                      <label class="field">
                        <span>Nome</span>
                        <input name="name" type="text" value="${escapeHtml(displayName)}" autocomplete="name" />
                      </label>
                      <label class="field">
                        <span>Nome do comércio</span>
                        <input name="businessName" type="text" value="${escapeHtml(business.name || displayName)}" autocomplete="organization" />
                      </label>
                      <label class="field">
                        <span>Telefone</span>
                        <input name="phone" type="tel" value="${escapeHtml(clientPhone)}" autocomplete="tel" placeholder="(00) 00000-0000" />
                      </label>
                    </div>
                  </section>
                  <section class="user-edit-panel__settings-block">
                    <div class="user-edit-panel__settings-block-head">
                      <span>Contato</span>
                      <strong>E-mail da conta</strong>
                    </div>
                    <label class="field">
                      <span>E-mail</span>
                      <input name="email" type="email" value="${escapeHtml(clientEmail)}" autocomplete="email" readonly />
                      <small class="user-edit-panel__field-note">Para alterar o e-mail, entre em contato com o suporte</small>
                    </label>
                  </section>
                  <section class="user-edit-panel__settings-block">
                    <div class="user-edit-panel__settings-block-head">
                      <span>Preferências</span>
                      <strong>Idioma</strong>
                    </div>
                    <label class="field">
                      <span>Idioma</span>
                      <select data-global-language aria-label="Language">
                        <option value="en">English</option>
                        <option value="pt">Português</option>
                      </select>
                    </label>
                  </section>
                  <p class="user-edit-panel__feedback" data-settings-feedback hidden></p>
                  <button class="user-edit-panel__action" type="submit" data-settings-save>Salvar alterações</button>
                </form>
              </section>
              <div class="user-edit-panel__actions-stack">
                <button class="user-edit-panel__action user-edit-panel__action--ghost" type="button" data-profile-back>Voltar</button>
              </div>
            </div>
          </section>
          <section class="user-edit-panel__view" data-profile-view="updates" hidden>
            <div class="user-edit-panel__page-head">
              <span>Sistema</span>
              <strong>Atualizações</strong>
            </div>
            <div class="user-edit-panel__page-shell">
              <div class="user-edit-panel__update-panel" data-update-panel>
                <strong>Atualizações do sistema</strong>
                <p data-update-current>Verifique se há uma nova versão disponível</p>
                <p data-update-notes></p>
                <button class="user-edit-panel__action" type="button" data-update-check>Verificar agora</button>
                <button class="user-edit-panel__action user-edit-panel__action--ghost" type="button" data-update-later hidden>Lembrar depois</button>
                <a class="user-edit-panel__action" data-update-now hidden target="_blank" rel="noopener">Atualizar agora</a>
              </div>
              <p class="user-edit-panel__feedback" data-update-feedback hidden></p>
              <div class="user-edit-panel__actions-stack">
                <button class="user-edit-panel__action user-edit-panel__action--ghost" type="button" data-profile-back>Voltar</button>
              </div>
            </div>
          </section>
          <section class="user-edit-panel__view" data-profile-view="support" hidden>
            <div class="user-edit-panel__page-head">
              <span>Ajuda e suporte</span>
              <strong>Suporte remoto</strong>
            </div>
            <div class="user-edit-panel__page-shell">
              <div class="user-edit-panel__support-card">
                <p>O suporte é feito remotamente pela equipe responsável pelo sistema</p>
                <p>Entre em contato com a equipe que instalou o Food System para combinar o atendimento Se necessário, tenha o AnyDesk disponível no computador do comércio</p>
                <p>Antes do atendimento, descreva o que aconteceu, em qual tela e o que você esperava que acontecesse</p>
              </div>
              <div class="user-edit-panel__actions-stack">
                <button class="user-edit-panel__action user-edit-panel__action--ghost" type="button" data-profile-back>Voltar</button>
              </div>
            </div>
          </section>
        </div>
      </div>
    `;
    document.body.append(backdrop, panel);
  }

  const openPanel = () => {
    backdrop.hidden = false;
    panel.hidden = false;
    requestAnimationFrame(() => {
      backdrop.classList.add("is-open");
      panel.classList.add("is-open");
    });
    document.body.classList.add("modal-open");
    button.setAttribute("aria-expanded", "true");
  };

  const closePanel = () => {
    backdrop.classList.remove("is-open");
    panel.classList.remove("is-open");
    button.setAttribute("aria-expanded", "false");
    document.body.classList.remove("modal-open");
    setTimeout(() => {
      backdrop.hidden = true;
      panel.hidden = true;
    }, 220);
  };

  button.innerHTML = `
    <svg class="profile-btn__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M12 12.2a4.6 4.6 0 1 0-4.6-4.6 4.61 4.61 0 0 0 4.6 4.6Zm0 2.2c-4.15 0-7.5 2.52-7.5 5.62V21h15v-1c0-3.1-3.35-5.6-7.5-5.6Z"/>
    </svg>
  `;
  button.setAttribute("aria-label", translate(`Perfil de ${displayName}`));

  let label = profile.querySelector(".profile-label");
  if (!label) {
    label = document.createElement("span");
    label.className = "profile-label";
    label.textContent = translate("Perfil");
    profile.appendChild(label);
  }
  label.setAttribute("role", "button");
  label.setAttribute("tabindex", "0");

  button.setAttribute("aria-expanded", "false");

  const heroAvatar = () => panel.querySelector(".user-edit-panel__avatar");
  const heroName = () => panel.querySelector(".user-edit-panel__hero-copy strong");
  const heroEmail = () => panel.querySelector(".user-edit-panel__hero-email");
  const settingsForm = panel.querySelector("[data-settings-form]");
  const settingsFeedback = panel.querySelector("[data-settings-feedback]");
  const settingsAvatarButton = panel.querySelector("[data-settings-avatar]");
  const settingsAvatarInput = panel.querySelector(".user-edit-panel__file-input");
  const settingsAvatarImage = panel.querySelector(".user-edit-panel__settings-avatar-image");
  const settingsAvatarPlaceholder = panel.querySelector(".user-edit-panel__settings-avatar-placeholder");
  const languageSelect = panel.querySelector("[data-global-language]");
  if (languageSelect) {
    languageSelect.value = getLanguage();
    languageSelect.addEventListener("change", () => {
      setLanguage(languageSelect.value);
      window.location.reload();
    });
  }
  let pendingAvatar = clientAvatar || "";

  const syncPanelIdentity = ({ name, email, phone, businessName, avatar }) => {
    displayName = name || businessName || "Usuário";
    clientEmail = email || "";
    business = {
      ...business,
      name: businessName || displayName,
      email: email || business.email || "",
      phone: phone || "",
      avatar: avatar || "",
    };
    session = session
      ? {
          ...session,
          name: displayName,
          email: email || session.email || "",
          phone: phone || "",
          avatar: avatar || "",
        }
      : session;

    const heroAvatarElement = heroAvatar();
    if (heroAvatarElement) heroAvatarElement.textContent = displayName.slice(0, 1).toUpperCase();
    const heroNameElement = heroName();
    if (heroNameElement) heroNameElement.textContent = displayName;
    const heroEmailElement = heroEmail();
    if (heroEmailElement) {
      heroEmailElement.textContent = clientEmail;
      heroEmailElement.hidden = !clientEmail;
    }
    button.setAttribute("aria-label", translate(`Perfil de ${displayName}`));
    if (label) label.textContent = translate("Perfil");

    if (settingsAvatarImage) {
      if (avatar) {
        settingsAvatarImage.src = avatar;
        settingsAvatarImage.hidden = false;
      } else {
        settingsAvatarImage.hidden = true;
        settingsAvatarImage.removeAttribute("src");
      }
    }

    if (settingsAvatarPlaceholder) {
      settingsAvatarPlaceholder.textContent = displayName.slice(0, 1).toUpperCase();
      settingsAvatarPlaceholder.hidden = Boolean(avatar);
    }
  };

  syncPanelIdentity({
    name: displayName,
    email: clientEmail,
    phone: clientPhone,
    businessName: business.name || displayName,
    avatar: pendingAvatar,
  });

  settingsAvatarButton?.addEventListener("click", () => settingsAvatarInput?.click());
  settingsAvatarInput?.addEventListener("change", () => {
    const file = settingsAvatarInput.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      pendingAvatar = String(reader.result || "");
      const values = Object.fromEntries(new FormData(settingsForm).entries());
      syncPanelIdentity({
        name: String(values.name || "").trim() || displayName,
        email: String(values.email || "").trim(),
        phone: String(values.phone || "").trim(),
        businessName: String(values.businessName || "").trim() || displayName,
        avatar: pendingAvatar,
      });
    };
    reader.readAsDataURL(file);
  });

  settingsForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitButton = settingsForm.querySelector("[data-settings-save]");
    const formData = new FormData(settingsForm);
    const name = String(formData.get("name") || "").trim();
    const email = String(session?.email || business.email || clientEmail || "").trim().toLowerCase();
    const phone = String(formData.get("phone") || "").trim();
    const businessName = String(formData.get("businessName") || "").trim() || name;

    if (!name || !email) {
      settingsFeedback.textContent = translate("Preencha nome e e-mail para salvar");
      settingsFeedback.className = "user-edit-panel__feedback user-edit-panel__feedback--error";
      settingsFeedback.hidden = false;
      return;
    }

    submitButton.disabled = true;
    settingsFeedback.textContent = translate("Salvando");
    settingsFeedback.className = "user-edit-panel__feedback";
    settingsFeedback.hidden = false;

    try {
      saveBusiness({
        name: businessName || name,
        email,
        phone,
        avatar: pendingAvatar,
      });

      if (session) {
        setSession({
          ...session,
          name,
          email,
          phone,
          avatar: pendingAvatar,
        });
        session = getSession();
      }

      await bootstrapApi();
      const menuSettings = getMenuSettings();
      await saveMenuSettingsRemote({
        ...menuSettings,
        businessName: businessName || name,
        menuName: menuSettings.menuName || business.name || businessName || name,
      });

      syncPanelIdentity({ name, email, phone, businessName, avatar: pendingAvatar });
      settingsFeedback.textContent = translate("Configurações salvas");
      settingsFeedback.className = "user-edit-panel__feedback user-edit-panel__feedback--success";
    } catch (error) {
      settingsFeedback.textContent = translate(error?.message || "Não foi possível salvar as configurações");
      settingsFeedback.className = "user-edit-panel__feedback user-edit-panel__feedback--error";
    } finally {
      settingsFeedback.hidden = false;
      submitButton.disabled = false;
    }
  });

  applyLegacyTranslations(panel);

  const updateCurrent = panel.querySelector("[data-update-current]");
  const updateNotes = panel.querySelector("[data-update-notes]");
  const updateFeedback = panel.querySelector("[data-update-feedback]");
  const updateCheck = panel.querySelector("[data-update-check]");
  const updateLater = panel.querySelector("[data-update-later]");
  const updateNow = panel.querySelector("[data-update-now]");

  const checkSystemUpdate = async () => {
    if (!updateFeedback) return;
    updateFeedback.hidden = false;
    updateFeedback.textContent = translate("Verificando atualizações");
    try {
      const result = await checkForSystemUpdates();
      updateCurrent.textContent = translate(`Versão instalada: ${result.current_version} Versão disponível: ${result.available_version}`);
      updateNotes.textContent = translate(result.notes || "O sistema já está atualizado");
      updateLater.hidden = !result.update_available;
      const safeUpdateUrl = typeof result.download_url === "string" && /^https:\/\//i.test(result.download_url) ? result.download_url : "";
      updateNow.hidden = !result.update_available || !safeUpdateUrl;
      updateNow.href = safeUpdateUrl || "#";
      updateNow.rel = "noopener noreferrer";
      updateFeedback.textContent = result.update_available
        ? result.download_url ? translate("Atualização disponível Escolha quando instalar") : translate("Há uma atualização registrada, mas o pacote ainda não foi disponibilizado")
        : translate("O sistema já está atualizado");
    } catch (error) {
      updateFeedback.textContent = translate(error?.message || "Não foi possível verificar atualizações");
    }
  };

  updateCheck?.addEventListener("click", checkSystemUpdate);
  updateLater?.addEventListener("click", () => {
    if (updateFeedback) {
      updateFeedback.textContent = translate("Tudo bem Você poderá verificar novamente quando quiser");
      updateFeedback.hidden = false;
    }
  });

  const switchProfileView = (viewName = "home") => {
    panel.classList.toggle("user-edit-panel--compact-view", viewName !== "home");
    panel.querySelectorAll("[data-profile-view]").forEach((view) => {
      const active = view.dataset.profileView === viewName;
      view.classList.toggle("is-current", active);
      view.hidden = !active;
    });
    const views = panel.querySelector(".user-edit-panel__views");
    if (views) views.scrollTop = 0;
  };

  const openFromEvent = (event) => {
    const target = event.target.closest(".profile-btn, .profile-label");
    if (!target || !profile.contains(target)) return;
    event.preventDefault();
    event.stopPropagation();
    switchProfileView("settings");
    openPanel();
  };

  button.addEventListener("click", openFromEvent);
  document.addEventListener("click", openFromEvent, true);

  backdrop.addEventListener("click", closePanel);
  panel.addEventListener("click", async (event) => {
    const closeButton = event.target.closest("[data-action='close-app']");
    if (closeButton) {
      event.preventDefault();
      closeApplication();
      return;
    }

    const openButton = event.target.closest("[data-profile-open]");
    if (openButton) {
      event.preventDefault();
      switchProfileView(openButton.dataset.profileOpen);
      return;
    }

    if (event.target.closest("[data-profile-back]")) {
      event.preventDefault();
      switchProfileView("home");
      return;
    }

    if (event.target.closest("[data-user-edit-close]")) {
      closePanel();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.hidden) closePanel();
  });

  label.addEventListener("click", (event) => {
    event.preventDefault();
    switchProfileView("settings");
    openPanel();
  });

  label.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      switchProfileView("settings");
      openPanel();
    }
  });
};

export const initUserEditPanel = () => {
  const trigger = document.querySelector("[data-user-edit-open]");
  const panel = document.getElementById("userEditPanel");
  const backdrop = document.getElementById("userEditBackdrop");
  if (!trigger || !panel || !backdrop) return;

  const openPanel = () => {
    backdrop.hidden = false;
    panel.hidden = false;
    requestAnimationFrame(() => {
      backdrop.classList.add("is-open");
      panel.classList.add("is-open");
    });
    document.body.classList.add("modal-open");
  };

  const closePanel = () => {
    backdrop.classList.remove("is-open");
    panel.classList.remove("is-open");
    document.body.classList.remove("modal-open");
    setTimeout(() => {
      backdrop.hidden = true;
      panel.hidden = true;
    }, 220);
  };

  trigger.addEventListener("click", (event) => {
    event.preventDefault();
    openPanel();
  });

  panel.querySelectorAll("[data-user-edit-close]").forEach((item) => {
    item.addEventListener("click", closePanel);
  });

  backdrop.addEventListener("click", closePanel);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.hidden) closePanel();
  });
};

const ensureProfileTrigger = () => {
  const sidebar = document.querySelector(".menu-sidebar");
  if (!sidebar || sidebar.querySelector(".profile")) return;

  const profile = document.createElement("div");
  profile.className = "profile menu-sidebar__profile";
  profile.innerHTML = `
    <button class="profile-btn" type="button" aria-label="${escapeHtml(translate("profile"))}">
      <svg class="profile-btn__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M12 12.2a4.6 4.6 0 1 0-4.6-4.6 4.61 4.61 0 0 0 4.6 4.6Zm0 2.2c-4.15 0-7.5 2.52-7.5 5.62V21h15v-1c0-3.1-3.35-5.6-7.5-5.6Z"/>
      </svg>
    </button>
    <span class="profile-label">${escapeHtml(translate("profile"))}</span>
  `;
  sidebar.append(profile);
};

export const initAppShell = async ({ activeNav } = {}) => {
  requireAuth();

  ensureCanonicalSidebarNavigation(activeNav);
  ensureProfileTrigger();
  setSidebarCollapsedState(getStoredSidebarCollapsedState());

  if (window.__foodSystemSidebarResizeBound !== true) {
    window.__foodSystemSidebarResizeBound = true;
    window.addEventListener("resize", () => setSidebarCollapsedState(getStoredSidebarCollapsedState()));
  }

  await bootstrapApi();
  applyLegacyTranslations(document);
  document.querySelectorAll("[data-action='close-app']").forEach((button) => {
    if (button.dataset.closeAppBound === "true") return;
    button.dataset.closeAppBound = "true";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      closeApplication();
    });
  });
  initProfileMenu();
  ensureBusinessOnboarding();

  if (!activeNav) return;

  document.querySelectorAll(".app-nav a").forEach((link) => {
    const href = link.getAttribute("href") || "";
    const isActive = href.includes(`/${activeNav}/`);
    link.classList.toggle("active", isActive);
    if (isActive) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });

  document.querySelectorAll(".menu-sidebar__nav a").forEach((link) => {
    const href = link.getAttribute("href") || "";
    const isActive = href.includes(`/${activeNav}/`) || href.includes(`${activeNav}/index.html`);
    link.classList.toggle("active", isActive);
    if (isActive) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
};

export const showToast = (message, { type = "success" } = {}) => {
  const existing = document.querySelector(".app-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.className = `app-toast app-toast--${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add("is-visible"));
  setTimeout(() => {
    toast.classList.remove("is-visible");
    setTimeout(() => toast.remove(), 250);
  }, 2600);
};
