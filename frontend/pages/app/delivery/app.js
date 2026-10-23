import { getSession } from "../../../shared/data/storage.js";
import { apiRequest } from "../../../shared/api/client.js";
import { initAppShell } from "../../../shared/ui/ui.js";

const businessId = getSession()?.businessId;
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
const courierList = document.getElementById("courierList");
const deliveryList = document.getElementById("deliveryList");
const statuses = ["assigned", "picked_up", "delivered", "cancelled"];

const load = async () => {
  const [couriers, deliveries] = await Promise.all([apiRequest(`/businesses/${businessId}/couriers`), apiRequest(`/businesses/${businessId}/deliveries`)]);
  courierList.innerHTML = couriers.couriers.length ? couriers.couriers.map((courier) => `<p>${escapeHtml(courier.name)}${courier.phone ? ` · ${escapeHtml(courier.phone)}` : ""}</p>`).join("") : "Nenhum entregador cadastrado.";
  deliveryList.innerHTML = deliveries.deliveries.length ? deliveries.deliveries.map((delivery) => {
    const address = typeof delivery.delivery_address === "string" ? JSON.parse(delivery.delivery_address) : delivery.delivery_address;
    const next = statuses.find((status) => status !== delivery.status && (delivery.status === "assigned" || delivery.status === "picked_up"));
    return `<article class="delivery-card"><div class="delivery-card__head"><strong>Pedido ${escapeHtml(String(delivery.order_id || "").slice(-6).toUpperCase())}</strong><strong>${escapeHtml(delivery.status)}</strong></div><div class="delivery-card__meta">${escapeHtml(address?.street || "Endereço não informado")}, ${escapeHtml(address?.number || "s/n")} · ${escapeHtml(address?.city || "")}</div><div>Entregador: ${escapeHtml(delivery.courier_name || "Não atribuído")}</div>${next ? `<div class="delivery-actions"><button class="btn btn--secondary" data-delivery-id="${escapeHtml(delivery.id)}" data-next-status="${next}">Marcar ${escapeHtml(next)}</button></div>` : ""}</article>`;
  }).join("") : "Nenhuma entrega registrada.";
};

document.getElementById("courierForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try { await apiRequest(`/businesses/${businessId}/couriers`, { method: "POST", body: { name: document.getElementById("courierName").value.trim(), phone: document.getElementById("courierPhone").value.trim() } }); event.target.reset(); document.getElementById("courierMessage").textContent = "Entregador cadastrado."; await load(); } catch (error) { document.getElementById("courierMessage").textContent = error.message; }
});

deliveryList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-delivery-id]");
  if (!button) return;
  try { await apiRequest(`/businesses/${businessId}/deliveries/${button.dataset.deliveryId}`, { method: "PATCH", body: { status: button.dataset.nextStatus } }); await load(); } catch (error) { document.getElementById("deliveryMessage").textContent = error.message; }
});

(async () => { await initAppShell({ activeNav: "delivery" }); await load(); })();
