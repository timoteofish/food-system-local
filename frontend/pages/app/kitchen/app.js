import "../../../shared/i18n/legacy-control.js";
import { getSession } from "../../../shared/data/storage.js";
import { apiRequest } from "../../../shared/api/client.js";
import { initAppShell } from "../../../shared/ui/ui.js";

const session = getSession();
const board = document.getElementById("kitchenBoard");
const statusMessage = document.getElementById("kitchenStatus");
const columns = [
  ["pending", "Pending", "confirmed"],
  ["confirmed", "Confirmed", "preparing"],
  ["preparing", "Preparing", "ready"],
  ["ready", "Ready", "completed"],
];
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
const orderCode = (order) => String(order.id || "").slice(-6).toUpperCase();

const load = async () => {
  const data = await apiRequest(`/businesses/${session.businessId}/orders`);
  const orders = data.orders || [];
  board.innerHTML = columns.map(([status, label, next]) => {
    const items = orders.filter((order) => order.status === status).map((order) => `<article class="kitchen-ticket"><div class="kitchen-ticket__head"><strong>#${escapeHtml(orderCode(order))}</strong><span>${escapeHtml(order.table_name || "Counter")}</span></div><ul>${(order.items || []).map((item) => `<li>${escapeHtml(item.quantity)} × ${escapeHtml(item.name)}</li>`).join("")}</ul><div><button class="btn btn--primary" data-order-id="${escapeHtml(order.id)}" data-next-status="${next}" type="button">${escapeHtml(next === "completed" ? "Complete" : `Move to ${next}`)}</button><button class="btn btn--secondary" data-print-order="${escapeHtml(order.id)}" type="button">Print</button></div></article>`).join("") || '<p>No orders.</p>';
    return `<section class="kitchen-column"><h2>${label} <span>(${orders.filter((order) => order.status === status).length})</span></h2>${items}</section>`;
  }).join("");
  statusMessage.textContent = `${orders.length} active order(s)`;
};

board.addEventListener("click", async (event) => {
  const printButton = event.target.closest("[data-print-order]");
  if (printButton) {
    const data = await apiRequest(`/businesses/${session.businessId}/orders/${printButton.dataset.printOrder}/print`);
    const ticket = data.ticket;
    const popup = window.open("", "_blank", "noopener,noreferrer,width=420,height=640");
    if (popup) { popup.document.write(`<html><head><title>Order ${escapeHtml(ticket.id.slice(-6))}</title><style>body{font-family:monospace;width:280px;margin:20px auto}h1{text-align:center;font-size:18px}hr{border:0;border-top:1px dashed #000}p{display:flex;justify-content:space-between}button{display:none}</style></head><body><h1>Food System</h1><p><span>Order</span><span>#${escapeHtml(ticket.id.slice(-6))}</span></p><p><span>Table</span><span>${escapeHtml(ticket.table_name || "Counter")}</span></p><hr>${ticket.items.map((item) => `<p><span>${escapeHtml(item.quantity)} x ${escapeHtml(item.name)}</span><span>${Number(item.total).toFixed(2)}</span></p>`).join("")}<hr><p><strong>Total</strong><strong>${Number(ticket.total).toFixed(2)}</strong></p><script>window.print();</script></body></html>`); popup.document.close(); }
    return;
  }
  const button = event.target.closest("[data-order-id]");
  if (!button) return;
  button.disabled = true;
  try { await apiRequest(`/businesses/${session.businessId}/orders/${button.dataset.orderId}/update_status`, { method: "PATCH", body: { status: button.dataset.nextStatus } }); await load(); }
  catch (error) { statusMessage.textContent = error.message; button.disabled = false; }
});
document.getElementById("refreshKitchen").addEventListener("click", load);
(async () => { await initAppShell({ activeNav: "kitchen" }); await load(); })();
