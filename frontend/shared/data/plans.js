import { fetchPlans } from "../api/client.js";

const normalize = (plan) => {
  const numericPrice =
    typeof plan.price === "number" ? plan.price : Number(plan.price || 0);
  const priceLabel =
    plan.price_label ||
    `R$\u00a0${numericPrice.toFixed(2).replace(".", ",").replace(",00", "")}`;

  return {
    id: plan.id,
    slug: plan.slug,
    name: plan.name,
    label: humanizeLabel(plan.name),
    price: numericPrice,
    price_label: priceLabel,
    description: plan.description || "",
    features: Array.isArray(plan.features) ? plan.features : [],
    position: plan.position ?? 0,
  };
};

const humanizeLabel = (name) => name;

let cached = null;

export const loadPlans = async ({ force = false } = {}) => {
  if (cached && !force) return cached;

  const remote = await fetchPlans();
  if (!Array.isArray(remote) || !remote.length) {
    throw new Error("Nenhum plano encontrado na API.");
  }

  cached = remote.map(normalize).sort((a, b) => a.position - b.position);
  return cached;
};

export const findPlan = async (slug) => {
  const list = await loadPlans();
  return list.find((p) => p.slug === slug) || null;
};

export const isFreePlan = (plan) => Number(plan?.price || 0) === 0;
