import { getBusiness, getMenuSettings, getSession, saveBusiness, setSession } from "../data/storage.js";
import { bootstrapApi, completeBusinessOnboarding, logout, requireAuth, saveMenuSettingsRemote } from "../auth/auth.js";
import { checkForSystemUpdates } from "../auth/auth.js";
import { escapeHtml } from "../utils/utils.js";

export { requireAuth };

const closeApplication = () => {
  const tauriWindow = window.__TAURI__?.window?.getCurrentWindow?.();
  if (tauriWindow) {
    void tauriWindow.close();
  } else {
    window.close();
  }
};

const SIDEBAR_COLLAPSE_KEY = "food-system-sidebar-collapsed";

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
    panel.setAttribute("aria-label", "Boas-vindas ao Food System");
    panel.innerHTML = `
      <div class="business-onboarding-panel__hero">
        <p class="business-onboarding-panel__eyebrow">Primeiro acesso</p>
        <h2>Vamos configurar seu negócio</h2>
        <p>Responda algumas perguntas rápidas para preparar o sistema para sua operação.</p>
      </div>
      <form class="business-onboarding-panel__form" data-business-onboarding-form>
        <div class="business-onboarding-panel__grid">
          <label class="field">
            <span>Nome do negócio</span>
            <input name="businessName" type="text" autocomplete="organization" placeholder="Ex.: Pizzaria Central" required />
          </label>
          <label class="field">
            <span>Tipo do negócio</span>
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
      feedback.textContent = "Salvando";

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
        feedback.textContent = error?.message || "Nao foi possivel salvar a configuracao inicial.";
      } finally {
        submit.disabled = false;
        form.dataset.submitting = "false";
      }
    });
  }
};

const applySidebarInlineState = (collapsed) => {
  const isCompactViewport = window.matchMedia("(max-width: 1023px)").matches;
  const mobileWidth = window.matchMedia("(max-width: 479px)").matches ? "208px" : "224px";
  const sidebar = document.querySelector(".menu-sidebar");
  const shell = document.querySelector(".menu-shell");
  const brand = document.querySelector(".menu-sidebar__brand");
  const brandRow = document.querySelector(".menu-sidebar__brand-row");
  const toggle = document.getElementById("menuSidebarToggle");
  const navLinks = document.querySelectorAll(".menu-sidebar__nav a");
  const labels = document.querySelectorAll(".menu-label");
  const profile = document.querySelector(".menu-sidebar__profile");
  const profileLabel = document.querySelector(".menu-sidebar__profile .profile-label");
  const content = document.querySelector(".menu-content");

  if (shell) {
    shell.dataset.sidebarState = collapsed ? "collapsed" : "expanded";
  }

  if (sidebar) {
    sidebar.style.width = collapsed ? (isCompactViewport ? "" : "84px") : isCompactViewport ? mobileWidth : "";
    sidebar.style.flexBasis = collapsed ? (isCompactViewport ? "" : "84px") : isCompactViewport ? mobileWidth : "";
    sidebar.style.padding = collapsed ? (isCompactViewport ? "" : "18px 10px") : isCompactViewport ? "18px 12px" : "";
    sidebar.style.position = isCompactViewport && !collapsed ? "fixed" : "";
    sidebar.style.left = isCompactViewport && !collapsed ? "0" : "";
    sidebar.style.zIndex = isCompactViewport && !collapsed ? "80" : "";
    sidebar.style.overflowY = isCompactViewport && !collapsed ? "auto" : "";
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

  if (toggle) {
    toggle.style.margin = collapsed ? "0 auto" : "";
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
  if (window.matchMedia("(max-width: 1023px)").matches) return true;

  const storedSidebarState = localStorage.getItem(SIDEBAR_COLLAPSE_KEY);
  if (storedSidebarState !== null) return storedSidebarState === "true";
  return false;
};

const ensureSidebarBackdrop = () => {
  let backdrop = document.getElementById("menuSidebarBackdrop");
  if (backdrop) return backdrop;

  backdrop = document.createElement("button");
  backdrop.id = "menuSidebarBackdrop";
  backdrop.className = "menu-sidebar-backdrop";
  backdrop.type = "button";
  backdrop.tabIndex = -1;
  backdrop.setAttribute("aria-label", "Fechar menu de navegação");
  document.body.appendChild(backdrop);
  return backdrop;
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
  const createdAt = session?.createdAt || business.createdAt || new Date().toISOString();
  const createdAtText = new Date(createdAt).toLocaleDateString("pt-BR");
  let clientEmail = session?.email || business.email || "";
  const clientPhone = business.phone || session?.phone || "";
  const clientAvatar = session?.avatar || business.avatar || "";
  const displayPlan = clientCategory;
  const supportEmail = clientEmail || business.email || "suporte@foodsystem.com";
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
    panel.setAttribute("aria-label", "Configurações do usuário");
    panel.innerHTML = `
      <div class="user-edit-panel__hero">
        <button type="button" class="user-edit-panel__close" data-user-edit-close aria-label="Fechar painel">×</button>
        <div class="user-edit-panel__hero-user">
          <div class="user-edit-panel__avatar" aria-hidden="true">${displayName.slice(0, 1).toUpperCase()}</div>
          <div class="user-edit-panel__hero-copy">
            <strong>${displayName}</strong>
            <span>${displayPlan}</span>
          </div>
        </div>
      </div>
      <div class="user-edit-panel__body">
        <div class="user-edit-panel__views">
          <section class="user-edit-panel__view is-current" data-profile-view="home">
            <div class="user-edit-panel__actions-stack">
              <button class="user-edit-panel__action" type="button" data-profile-open="settings">Configurações</button>
              <button class="user-edit-panel__action" type="button" data-profile-open="updates">Atualizações do sistema</button>
              <button class="user-edit-panel__action" type="button" data-profile-open="support">Suporte</button>
              <button class="user-edit-panel__action user-edit-panel__action--danger" type="button" data-action="close-app">Fechar aplicação</button>
            </div>
          </section>
          <section class="user-edit-panel__view" data-profile-view="settings" hidden>
            <div class="user-edit-panel__page-head">
              <span>Central da conta</span>
              <strong>Ajustes rápidos do perfil</strong>
            </div>
            <div class="user-edit-panel__page-shell">
              <section class="user-edit-panel__settings-shell">
                <aside class="user-edit-panel__settings-side">
                  <div class="user-edit-panel__settings-avatar">
                    <div class="user-edit-panel__settings-avatar-frame">
                      <img class="user-edit-panel__settings-avatar-image" alt="Foto do usuário" ${clientAvatar ? `src="${clientAvatar}"` : "hidden"} />
                      <span class="user-edit-panel__settings-avatar-placeholder" ${clientAvatar ? "hidden" : ""}>${displayName.slice(0, 1).toUpperCase()}</span>
                    </div>
                    <div class="user-edit-panel__settings-avatar-copy">
                      <strong>Imagem do perfil</strong>
                      <small>Mantenha a identidade da conta ajustável sem sair desta janela.</small>
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
                      <span>Identidade</span>
                      <strong>Dados principais da conta</strong>
                    </div>
                    <div class="user-edit-panel__settings-grid">
                      <label class="field">
                        <span>Nome</span>
                        <input name="name" type="text" value="${displayName}" autocomplete="name" />
                      </label>
                      <label class="field">
                        <span>Nome do negócio</span>
                        <input name="businessName" type="text" value="${business.name || displayName}" autocomplete="organization" />
                      </label>
                      <label class="field">
                        <span>Telefone</span>
                        <input name="phone" type="tel" value="${clientPhone}" autocomplete="tel" placeholder="(00) 00000-0000" />
                      </label>
                    </div>
                  </section>
                  <section class="user-edit-panel__settings-block">
                    <div class="user-edit-panel__settings-block-head">
                      <span>Acesso</span>
                      <strong>E-mail de cadastro protegido</strong>
                    </div>
                    <label class="field">
                      <span>E-mail</span>
                      <input name="email" type="email" value="${clientEmail}" autocomplete="email" readonly />
                      <small class="user-edit-panel__field-note">O e-mail do cadastro fica bloqueado aqui. Alterações futuras exigirão validação da conta.</small>
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
              <span>Central de assinatura</span>
              <strong>Área de planos</strong>
            </div>
            <div class="user-edit-panel__page-shell">
              <div class="user-edit-panel__plan-catalog" data-update-panel>
                <strong>Atualizações do sistema</strong>
                <p data-update-current>Verificação ainda não executada.</p>
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
              <span>Suporte centralizado</span>
              <strong>Fale com o suporte</strong>
            </div>
            <div class="user-edit-panel__page-shell">
              <form class="user-edit-panel__support-form" data-support-form>
                <label class="field field--support-message">
                  <span>Mensagem</span>
                  <textarea name="message" rows="6" placeholder="Descreva o que aconteceu, em qual tela ocorreu e qual comportamento você esperava."></textarea>
                </label>
                <label class="user-edit-panel__support-upload">
                  <strong>Anexar captura de tela</strong>
                  <small>PNG, JPG ou WEBP para ajudar na análise do problema.</small>
                  <input name="attachment" type="file" accept="image/*" />
                  <span class="user-edit-panel__support-upload-button">Browse</span>
                  <p class="user-edit-panel__support-upload-status" data-support-file-status>No file selected</p>
                </label>
                <p class="user-edit-panel__feedback" data-support-feedback hidden></p>
                <button class="user-edit-panel__action" type="submit" data-support-submit>Enviar mensagem</button>
              </form>
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
  button.setAttribute("aria-label", `Perfil de ${displayName}`);

  let label = profile.querySelector(".profile-label");
  if (!label) {
    label = document.createElement("span");
    label.className = "profile-label";
    label.textContent = "Ver Perfil";
    profile.appendChild(label);
  }
  label.setAttribute("role", "button");
  label.setAttribute("tabindex", "0");

  button.setAttribute("aria-expanded", "false");

  const heroAvatar = () => panel.querySelector(".user-edit-panel__avatar");
  const heroName = () => panel.querySelector(".user-edit-panel__hero-copy strong");
  const settingsForm = panel.querySelector("[data-settings-form]");
  const settingsFeedback = panel.querySelector("[data-settings-feedback]");
  const settingsAvatarButton = panel.querySelector("[data-settings-avatar]");
  const settingsAvatarInput = panel.querySelector(".user-edit-panel__file-input");
  const settingsAvatarImage = panel.querySelector(".user-edit-panel__settings-avatar-image");
  const settingsAvatarPlaceholder = panel.querySelector(".user-edit-panel__settings-avatar-placeholder");
  const planCatalog = panel.querySelector("[data-plan-catalog]");
  const planFeedback = panel.querySelector("[data-plan-feedback]");
  const supportForm = panel.querySelector("[data-support-form]");
  const supportFeedback = panel.querySelector("[data-support-feedback]");
  const supportFileInput = supportForm?.querySelector("input[name='attachment']");
  const supportFileStatus = panel.querySelector("[data-support-file-status]");
  let pendingAvatar = clientAvatar || "";
  let availablePlans = [];

  const humanPlanLabel = (slug) => {
    const normalized = String(slug || "").trim().toLowerCase();
    return slug || "Aplicação local";
  };

  const formatDate = (value) =>
    new Date(value).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });

  const addDays = (baseDate, days) => {
    const next = new Date(baseDate);
    next.setDate(next.getDate() + days);
    return next;
  };

  const getPlanCycle = () => {
    const currentSession = getSession() || session || {};
    const anchor = currentSession.planChangedAt || currentSession.loggedAt || createdAt;
    const startedAt = new Date(anchor);
    const isCurrentFree = String(currentSession.plan || clientCategory || "").toLowerCase() === "gratis";
    const nextBillingAt = isCurrentFree ? null : addDays(startedAt, 30);
    const nextRenewalAt = isCurrentFree ? addDays(startedAt, 7) : addDays(startedAt, 30);
    return {
      startedAt,
      nextBillingAt,
      nextRenewalAt,
      paymentMethod: currentSession.planPaymentMethod || (isCurrentFree ? "Sem cobrança" : "Pix recorrente"),
    };
  };

  const renderPlanPanel = async () => {
    if (!planCatalog) return;

    const cycle = getPlanCycle();
    const currentPlanSlug = String(getSession()?.plan || session?.plan || clientCategory || "").toLowerCase();
    const nextChargeText = cycle.nextBillingAt ? formatDate(cycle.nextBillingAt) : "Sem cobrança programada";

    if (!availablePlans.length) {
      planCatalog.innerHTML = `
        <div class="user-edit-panel__plan-state">
          <strong>Carregando planos</strong>
          <small>Assinatura</small>
        </div>
      `;
      try {
        availablePlans = [];
      } catch {
        availablePlans = [];
      }
    }

    if (!availablePlans.length) {
      planCatalog.innerHTML = `
        <div class="user-edit-panel__plan-state">
          <strong>Não foi possível carregar os planos.</strong>
          <small>Tente novamente em instantes.</small>
        </div>
      `;
      return;
    }

    planCatalog.innerHTML = availablePlans
      .map((plan) => {
        const current = plan.slug === currentPlanSlug;
        const priceText = "Aplicação local";
        const actionLabel = current ? "Instalado" : "Disponível";
        const billingNote = current
          ? `
            <div class="user-edit-panel__plan-reminder">
              <span>Próxima cobrança</span>
              <strong>${nextChargeText}</strong>
              <small>${cycle.nextBillingAt ? `Método previsto: ${cycle.paymentMethod}` : "Nenhum valor será cobrado enquanto o plano gratuito estiver ativo."}</small>
            </div>
          `
          : "";
        return `
          <article class="user-edit-panel__plan-option ${current ? "is-current" : ""}">
            <div class="user-edit-panel__plan-option-head">
              <div>
                <span>${escapeHtml(plan.label || plan.name)}</span>
                <strong>${escapeHtml(priceText)}</strong>
              </div>
              ${current ? '<em>Ativo</em>' : ""}
            </div>
            <p>${escapeHtml(plan.description || "Plano disponível para sua operação.")}</p>
            ${billingNote}
            <ul>
              ${(plan.features || []).slice(0, 4).map((feature) => `<li>${escapeHtml(feature)}</li>`).join("")}
            </ul>
            <button class="user-edit-panel__action ${current ? "user-edit-panel__action--ghost" : ""}" type="button" data-plan-change="${escapeHtml(plan.slug)}" ${current ? "disabled" : ""}>
              ${escapeHtml(actionLabel)}
            </button>
          </article>
        `;
      })
      .join("");
  };

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
    button.setAttribute("aria-label", `Perfil de ${displayName}`);
    if (label) label.textContent = "Ver Perfil";

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
      settingsFeedback.textContent = "Preencha nome e e-mail para salvar.";
      settingsFeedback.className = "user-edit-panel__feedback user-edit-panel__feedback--error";
      settingsFeedback.hidden = false;
      return;
    }

    submitButton.disabled = true;
    settingsFeedback.textContent = "Salvando";
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
      settingsFeedback.textContent = "Configurações atualizadas nesta janela.";
      settingsFeedback.className = "user-edit-panel__feedback user-edit-panel__feedback--success";
    } catch (error) {
      settingsFeedback.textContent = error?.message || "Não foi possível salvar as configurações.";
      settingsFeedback.className = "user-edit-panel__feedback user-edit-panel__feedback--error";
    } finally {
      settingsFeedback.hidden = false;
      submitButton.disabled = false;
    }
  });

  supportForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitButton = supportForm.querySelector("[data-support-submit]");
    const formData = new FormData(supportForm);
    const message = String(formData.get("message") || "").trim();
    const attachment = formData.get("attachment");

    if (!message) {
      supportFeedback.textContent = "Descreva o problema antes de enviar.";
      supportFeedback.className = "user-edit-panel__feedback user-edit-panel__feedback--error";
      supportFeedback.hidden = false;
      return;
    }

    submitButton.disabled = true;
    supportFeedback.textContent = "Enviando";
    supportFeedback.className = "user-edit-panel__feedback";
    supportFeedback.hidden = false;

    try {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const hasAttachment = attachment instanceof File && attachment.size > 0;
      supportFeedback.textContent = hasAttachment
        ? "Mensagem enviada com imagem"
        : "Mensagem enviada";
      supportFeedback.className = "user-edit-panel__feedback user-edit-panel__feedback--success";
      supportForm.reset();
    } catch (error) {
      supportFeedback.textContent = error?.message || "Não foi possível enviar a mensagem agora.";
      supportFeedback.className = "user-edit-panel__feedback user-edit-panel__feedback--error";
    } finally {
      supportFeedback.hidden = false;
      submitButton.disabled = false;
    }
  });

  supportFileInput?.addEventListener("change", () => {
    const file = supportFileInput.files?.[0];
    if (!supportFileStatus) return;
    supportFileStatus.textContent = file?.name || "No file selected";
  });

  const updateCurrent = panel.querySelector("[data-update-current]");
  const updateNotes = panel.querySelector("[data-update-notes]");
  const updateFeedback = panel.querySelector("[data-update-feedback]");
  const updateCheck = panel.querySelector("[data-update-check]");
  const updateLater = panel.querySelector("[data-update-later]");
  const updateNow = panel.querySelector("[data-update-now]");

  const checkSystemUpdate = async () => {
    if (!updateFeedback) return;
    updateFeedback.hidden = false;
    updateFeedback.textContent = "Verificando atualizações...";
    try {
      const result = await checkForSystemUpdates();
      updateCurrent.textContent = `Versão instalada: ${result.current_version}. Versão disponível: ${result.available_version}.`;
      updateNotes.textContent = result.notes || "O sistema já está atualizado.";
      updateLater.hidden = !result.update_available;
      updateNow.hidden = !result.update_available || !result.download_url;
      updateNow.href = result.download_url || "#";
      updateFeedback.textContent = result.update_available
        ? result.download_url ? "Atualização disponível. Escolha quando instalar." : "Há uma atualização registrada, mas o pacote ainda não foi disponibilizado."
        : "O sistema já está atualizado.";
    } catch (error) {
      updateFeedback.textContent = error?.message || "Não foi possível verificar atualizações.";
    }
  };

  updateCheck?.addEventListener("click", checkSystemUpdate);
  updateLater?.addEventListener("click", () => {
    if (updateFeedback) {
      updateFeedback.textContent = "Tudo bem. Você poderá verificar novamente quando quiser.";
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
    switchProfileView("home");
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
    switchProfileView("home");
    openPanel();
  });

  label.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      switchProfileView("home");
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

export const initAppShell = async ({ activeNav } = {}) => {
  requireAuth();

  setSidebarCollapsedState(getStoredSidebarCollapsedState());
  const sidebarBackdrop = ensureSidebarBackdrop();

  const syncSidebarDrawer = () => {
    const isCompactViewport = window.matchMedia("(max-width: 1023px)").matches;
    const isCollapsed = document.body.classList.contains("menu-sidebar-collapsed");
    const isDrawerOpen = isCompactViewport && !isCollapsed;
    document.body.classList.toggle("menu-sidebar-drawer-open", isDrawerOpen);
    sidebarBackdrop.hidden = !isDrawerOpen;
  };
  syncSidebarDrawer();

  sidebarBackdrop.addEventListener("click", () => {
    setSidebarCollapsedState(true);
    syncSidebarDrawer();
  });

  if (window.__foodSystemSidebarResizeBound !== true) {
    window.__foodSystemSidebarResizeBound = true;
    window.addEventListener("resize", () => {
      setSidebarCollapsedState(getStoredSidebarCollapsedState());
      syncSidebarDrawer();
    });
  }

  const menuSidebarToggle = document.getElementById("menuSidebarToggle");
  if (menuSidebarToggle && menuSidebarToggle.dataset.sidebarBound !== "true") {
    menuSidebarToggle.dataset.sidebarBound = "true";
    menuSidebarToggle.addEventListener("click", () => {
      const collapsed = !document.body.classList.contains("menu-sidebar-collapsed");
      setSidebarCollapsedState(collapsed);
      localStorage.setItem(SIDEBAR_COLLAPSE_KEY, String(collapsed));
      syncSidebarDrawer();
    });
  }

  if (document.body.dataset.sidebarEscapeBound !== "true") {
    document.body.dataset.sidebarEscapeBound = "true";
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && document.body.classList.contains("menu-sidebar-drawer-open")) {
        setSidebarCollapsedState(true);
        syncSidebarDrawer();
      }
    });
  }

  await bootstrapApi();
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
    link.classList.toggle("active", href.includes(`/${activeNav}/`));
  });

  document.querySelectorAll(".menu-sidebar__nav a").forEach((link) => {
    const href = link.getAttribute("href") || "";
    link.classList.toggle("active", href.includes(`/${activeNav}/`) || href.includes(`${activeNav}/index.html`));
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
