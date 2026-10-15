import { processCheckout } from "../../../shared/features/auth/index.js";
import { isFreePlan, loadPlans } from "../../../shared/data/plans.js";
import { getPendingRegistration, getSession } from "../../../shared/data/storage.js";
import { goWithLoading } from "../../../shared/utils/navigation.js";

const params = new URLSearchParams(window.location.search);
const requestedSlug = params.get("plan") || "completo";

const paymentMethods = {
  pix: { label: "Pix", backendValue: "pix" },
  credit: { label: "Cartão de crédito", backendValue: "credit_card" },
  debit: { label: "Cartão de débito", backendValue: "debit_card" },
};

const refs = {
  eyebrow: document.getElementById("selectedPlanEyebrow"),
  name: document.getElementById("selectedPlanName"),
  price: document.getElementById("selectedPlanPrice"),
  card: document.getElementById("selectedPlanCard"),
  badge: document.getElementById("planSourceBadge"),
  methodInput: document.getElementById("method"),
  methodButtons: Array.from(document.querySelectorAll(".payment-method")),
  details: document.querySelector(".payment-details"),
  feedback: document.getElementById("paymentFeedback"),
  form: document.getElementById("paymentForm"),
  submit: document.getElementById("submitButton"),
  methodsBlock: document.querySelector(".payment-methods"),
  holderField: document.getElementById("holder")?.closest(".field"),
};

let currentPlan = null;

const formatPrice = (value) => {
  const numeric = Number(value || 0);
  if (numeric === 0) return "R$ 0";
  return `R$ ${numeric.toFixed(2).replace(".", ",").replace(",00", "")}`;
};

const renderPlan = (plan) => {
  currentPlan = plan;
  refs.name.textContent = plan.label || plan.name;
  refs.price.textContent = formatPrice(plan.price);
  refs.submit.textContent = plan.slug === "gratis" ? "Começar com plano grátis" : "Confirmar pagamento";

  refs.card.classList.toggle("selected-plan-card--featured", plan.slug === "completo");
};

const renderLoading = () => {
  refs.name.textContent = "Carregando plano";
  refs.price.textContent = "-";
  refs.card.classList.remove("selected-plan-card--featured");
  if (refs.details) {
    refs.details.innerHTML = `
      <div class="payment-loading">
        <div class="payment-loading__line payment-loading__line--title"></div>
        <div class="payment-loading__line"></div>
        <div class="payment-loading__line short"></div>
      </div>
    `;
  }
};

const showSourceBadge = (source) => {
  if (!refs.badge) return;
  refs.badge.classList.remove(
    "plan-source-badge--api",
    "plan-source-badge--local"
  );
  if (source === "api") {
    refs.badge.textContent = "Sincronizado";
    refs.badge.classList.add("plan-source-badge--api");
    refs.badge.hidden = false;
  } else {
    refs.badge.hidden = true;
  }
};

const setMethod = (method) => {
  refs.methodInput.value = method;
  refs.methodButtons.forEach((button) => {
    const active = button.dataset.method === method;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  renderDetails(method);
};

const renderDetails = (method) => {
  if (!refs.details) return;
  if (method === "credit" || method === "debit") {
    refs.details.innerHTML = `
      <div class="payment-card-fields">
        <div class="field"><label for="cardNumber">Número do cartão</label><input id="cardNumber" type="text" placeholder="0000 0000 0000 0000" /></div>
        <div class="payment-card-row">
          <div class="field"><label for="cardExp">Validade</label><input id="cardExp" type="text" placeholder="MM/AA" /></div>
          <div class="field"><label for="cardCvv">CVV</label><input id="cardCvv" type="text" placeholder="123" /></div>
        </div>
      </div>
    `;
    return;
  }

  if (method === "pix") {
    refs.details.innerHTML = `
      <div class="pix-payment-details">
        <div class="pix-qr-placeholder">
          <strong>QR code</strong>
          <div class="pix-qr-box"></div>
        </div>
        <div class="pix-key-copy">
          <label for="pixKey">Chave Pix</label>
          <div class="pix-key-input">
            <span id="pixKey">pagamentos@foodsystem.com</span>
            <button type="button" class="pix-copy-button" id="copyPixKey" aria-label="Copiar chave Pix">
              Copiar
            </button>
          </div>
          <span class="pix-copy-status" id="pixCopyStatus" aria-live="polite"></span>
        </div>
      </div>
    `;

    refs.details.querySelector("#copyPixKey")?.addEventListener("click", () => {
      const pixKey = refs.details.querySelector("#pixKey");
      const copyStatus = refs.details.querySelector("#pixCopyStatus");
      navigator.clipboard
        .writeText(pixKey.textContent.trim())
        .then(() => {
          copyStatus.textContent = "Chave copiada";
        })
        .catch(() => {
          copyStatus.textContent = "Falha ao copiar";
        });
    });
    return;
  }

  refs.details.innerHTML = "";
};

const applyFreePlanUi = () => {
  if (refs.methodsBlock) refs.methodsBlock.closest(".field").style.display = "none";
  if (refs.holderField) refs.holderField.style.display = "none";
  if (refs.details) refs.details.innerHTML = "";
};

const showFeedback = (message, type = "error") => {
  if (!refs.feedback) return;
  refs.feedback.textContent = message;
  refs.feedback.className = `form-feedback form-feedback--${type}`;
  refs.feedback.hidden = false;
};

const clearFeedback = () => {
  if (!refs.feedback) return;
  refs.feedback.hidden = true;
  refs.feedback.textContent = "";
};

const init = async () => {
  const initialPending = getPendingRegistration();
  if (!initialPending && !getSession()) {
    goWithLoading("/frontend/pages/auth/register/index.html");
    return;
  }
  if (initialPending && !initialPending.businessName) {
    goWithLoading("/frontend/pages/auth/validation/index.html");
    return;
  }

  renderLoading();
  if (requestedSlug === "gratis") {
    if (refs.submit) refs.submit.disabled = true;
    try {
      await processCheckout({ planSlug: "gratis", paymentMethod: "free" });
      goWithLoading("/frontend/pages/app/menu/index.html");
    } catch (error) {
      showFeedback(error.message || "Não foi possível ativar o plano grátis.");
      if (refs.submit) refs.submit.disabled = false;
    }
    return;
  }

  let plans;
  try {
    plans = await loadPlans({ force: true });
  } catch (error) {
    showFeedback("Não foi possível carregar os planos");
    return;
  }

  const plan =
    plans.find((p) => p.slug === requestedSlug) ||
    plans[plans.length - 1] ||
    null;

  if (!plan) {
    showFeedback("Plano inválido");
    return;
  }

  renderPlan(plan);
  showSourceBadge(plan.id?.startsWith("local-") ? "local" : "api");

  if (isFreePlan(plan)) {
    applyFreePlanUi();
  } else {
    setMethod(refs.methodInput.value || "pix");
    refs.methodButtons.forEach((button) => {
      button.addEventListener("click", () => setMethod(button.dataset.method));
    });
  }

  refs.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearFeedback();

    const pending = getPendingRegistration();
    if (!pending && !getSession()) {
      showFeedback("Confira os dados");
      return;
    }

    if (refs.submit) refs.submit.disabled = true;

    try {
      const holder = document.getElementById("holder")?.value?.trim() || "";
      const method = refs.methodInput.value || "pix";
      const backendMethod = isFreePlan(plan)
        ? "free"
        : paymentMethods[method]?.backendValue || method;

      await processCheckout({
        planSlug: plan.slug,
        paymentMethod: backendMethod,
        metadata: { holder },
      });

      goWithLoading("/frontend/pages/app/dashboard/index.html");
    } catch (error) {
      showFeedback(error.message || "Não foi possível concluir o pagamento.");
      if (refs.submit) refs.submit.disabled = false;
    }
  });
};

document.addEventListener("DOMContentLoaded", init);
