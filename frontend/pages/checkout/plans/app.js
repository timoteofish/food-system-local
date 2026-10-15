import { processCheckout } from "../../../shared/features/auth/index.js";
import { isFreePlan, loadPlans } from "../../../shared/data/plans.js";
import { getPendingRegistration, getSession } from "../../../shared/data/storage.js";
import { goWithLoading } from "../../../shared/utils/navigation.js";

const grid = document.getElementById("planGrid");

const showError = (message) => {
  grid.removeAttribute("aria-busy");
  grid.innerHTML = `
    <div class="plan-grid__state plan-grid__state--error">
      <strong>Não foi possível carregar os planos</strong>
      <p>${message}</p>
      <button class="btn btn--secondary" type="button" id="retryPlans">Tentar novamente</button>
    </div>
  `;
  document.getElementById("retryPlans")?.addEventListener("click", init);
};

const renderSkeleton = () => {
  grid.setAttribute("aria-busy", "true");
  grid.innerHTML = Array.from({ length: 3 })
    .map(
      () => `
      <article class="plan-card plan-card--skeleton" aria-hidden="true">
        <div class="plan-skeleton plan-skeleton--badge"></div>
        <div class="plan-card__top">
          <div>
            <div class="plan-skeleton plan-skeleton--eyebrow"></div>
            <div class="plan-skeleton plan-skeleton--title"></div>
          </div>
          <div class="plan-skeleton plan-skeleton--price"></div>
        </div>
        <div class="plan-skeleton plan-skeleton--line"></div>
        <div class="plan-skeleton plan-skeleton--line"></div>
        <div class="plan-skeleton plan-skeleton--line short"></div>
        <div class="plan-skeleton plan-skeleton--button"></div>
      </article>
    `
    )
    .join("");
};

const activateFreeAndGo = async (cta) => {
  const pending = getPendingRegistration();
  if (!pending && !getSession()) {
    goWithLoading("/frontend/pages/auth/register/index.html");
    return;
  }
  if (pending && !pending.businessName) {
    goWithLoading("/frontend/pages/auth/validation/index.html");
    return;
  }
  cta.disabled = true;
  const original = cta.textContent;
  cta.textContent = "Ativando";
  try {
    await processCheckout({ planSlug: "gratis", paymentMethod: "free" });
    goWithLoading("/frontend/pages/app/menu/index.html");
  } catch (error) {
    cta.disabled = false;
    cta.textContent = original;
    showError(error.message || "Não foi possível ativar o plano grátis.");
  }
};

const buildCard = (plan) => {
  const isFeatured = plan.slug === "completo";
  const isFree = isFreePlan(plan);
  const variant = isFree
    ? "plan-card plan-card--free"
    : isFeatured
      ? "plan-card plan-card--featured"
      : "plan-card";
  const ctaClass = isFeatured ? "btn btn--primary" : "btn btn--secondary";

  const card = document.createElement("article");
  card.className = variant;

  if (isFeatured) {
    const badge = document.createElement("span");
    badge.className = "plan-card__badge";
    badge.textContent = "Mais escolhido";
    card.appendChild(badge);
  }

  const top = document.createElement("div");
  top.className = "plan-card__top";
  const heading = document.createElement("div");
  const eyebrow = document.createElement("p");
  eyebrow.className = "plan-label";
  eyebrow.textContent = plan.label || plan.name;
  const title = document.createElement("h3");
  title.textContent = plan.description || "";
  heading.append(eyebrow, title);
  const price = document.createElement("strong");
  price.className = "plan-price";
  price.textContent = plan.price_label;
  top.append(heading, price);

  const desc = document.createElement("p");
  desc.className = "plan-desc";
  desc.textContent = plan.description || "";

  const list = document.createElement("ul");
  list.className = "plan-list" + (isFree ? " plan-list--restrictions" : "");
  (plan.features || []).forEach((text) => {
    const li = document.createElement("li");
    li.textContent = text;
    list.appendChild(li);
  });

  const cta = document.createElement("a");
  cta.className = ctaClass;
  cta.href = isFree
    ? "../../app/menu/index.html"
    : `../payment/index.html?plan=${encodeURIComponent(plan.slug)}`;
  cta.dataset.plan = plan.slug;
  cta.textContent = isFree ? "Começar grátis" : "Escolher";

  if (isFree) {
    cta.addEventListener("click", (event) => {
      event.preventDefault();
      activateFreeAndGo(cta);
    });
  }

  card.append(top, desc, list, cta);
  return card;
};

const init = async () => {
  const pending = getPendingRegistration();
  if (!pending && !getSession()) {
    goWithLoading("/frontend/pages/auth/register/index.html");
    return;
  }
  if (pending && !pending.businessName) {
    goWithLoading("/frontend/pages/auth/validation/index.html");
    return;
  }

  renderSkeleton();
  let plans;
  try {
    plans = await loadPlans({ force: true });
  } catch (error) {
    showError("Tente novamente");
    return;
  }

  grid.removeAttribute("aria-busy");
  grid.innerHTML = "";
  plans.forEach((plan) => grid.appendChild(buildCard(plan)));
};

init();
