import { API_BASE_URL } from "../../shared/api/config.js";

if ("serviceWorker" in navigator && location.protocol === "https:") void navigator.serviceWorker.register("./sw.js");

import "../../shared/i18n/legacy-control.js";
import { getLocale, translate } from "../../shared/i18n/i18n.js";

const tokenKey = "food-system-courier-token";
const tokenInput = document.getElementById("courierToken");
const form = document.getElementById("tokenForm");
const message = document.getElementById("message");
const deliveries = document.getElementById("deliveries");
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
const statusLabels = { assigned: "Aguardando coleta", picked_up: "Em trânsito", delivered: "Entregue", cancelled: "Cancelada" };
const actionLabels = { picked_up: "Iniciar entrega", delivered: "Concluir entrega" };
const getToken = () => localStorage.getItem(tokenKey) || "";
const parseResponse = async (response) => {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Não foi possível acessar as entregas");
  return data;
};

const load = async () => {
  const token = getToken();
  if (!token) { deliveries.innerHTML = ""; return; }
  try {
    const response = await fetch(`${API_BASE_URL}/courier/deliveries`, { headers: { Accept: "application/json", "X-Courier-Token": token } });
    const data = await parseResponse(response);
    message.textContent = `${translate("Entregador: ")}${data.courier.name}`;
    deliveries.innerHTML = data.deliveries.length ? data.deliveries.map((delivery) => {
      const address = typeof delivery.delivery_address === "string" ? JSON.parse(delivery.delivery_address) : delivery.delivery_address || {};
      const next = delivery.status === "assigned" ? "picked_up" : delivery.status === "picked_up" ? "delivered" : null;
      return `<article><div class="status">${escapeHtml(translate(statusLabels[delivery.status] || "Não identificado"))}</div><h2>${escapeHtml(translate("Pedido "))}#${escapeHtml(String(delivery.order_id).slice(-6).toUpperCase())}</h2><div class="meta">${escapeHtml(address.street || translate("Endereço não informado"))}, ${escapeHtml(address.number || "s/n")} · ${escapeHtml(address.city || "")}</div><div class="meta">${escapeHtml(translate("Total"))}: ${Number(delivery.total || 0).toLocaleString(getLocale(), { style: "currency", currency: "BRL" })}</div>${next ? `<div class="actions"><button data-id="${escapeHtml(delivery.id)}" data-status="${next}">${escapeHtml(translate(actionLabels[next] || "Atualizar entrega"))}</button></div>` : ""}</article>`;
    }).join("") : `<p>${escapeHtml(translate("Nenhuma entrega atribuída."))}</p>`;
  } catch (error) { message.textContent = translate(error.message); deliveries.innerHTML = ""; }
};

form.addEventListener("submit", (event) => { event.preventDefault(); localStorage.setItem(tokenKey, tokenInput.value.trim()); tokenInput.value = ""; void load(); });
document.getElementById("clearToken").addEventListener("click", () => { localStorage.removeItem(tokenKey); deliveries.innerHTML = ""; message.textContent = translate("Token removido deste dispositivo"); });
document.getElementById("sendLocation").addEventListener("click", () => {
  if (!navigator.geolocation) { message.textContent = translate("A geolocalização não está disponível neste dispositivo"); return; }
  message.textContent = translate("Solicitando localização");
  navigator.geolocation.getCurrentPosition(async ({ coords }) => {
    try {
      const response = await fetch(`${API_BASE_URL}/courier/location`, { method: "POST", headers: { "Content-Type": "application/json", "X-Courier-Token": getToken() }, body: JSON.stringify({ latitude: Number(coords.latitude.toFixed(7)), longitude: Number(coords.longitude.toFixed(7)), accuracy_m: Number(coords.accuracy.toFixed(2)) }) });
      await parseResponse(response);
      message.textContent = translate("Localização enviada");
    } catch (error) { message.textContent = translate(error.message); }
  }, (error) => { message.textContent = error.message ? translate(error.message) : translate("Não foi possível obter sua localização"); }, { enableHighAccuracy: true, maximumAge: 30000, timeout: 10000 });
});
deliveries.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-id]");
  if (!button) return;
  button.disabled = true;
  try {
    const response = await fetch(`${API_BASE_URL}/courier/deliveries/${button.dataset.id}`, { method: "PATCH", headers: { "Content-Type": "application/json", "X-Courier-Token": getToken() }, body: JSON.stringify({ status: button.dataset.status }) });
    await parseResponse(response);
    await load();
  } catch (error) { message.textContent = translate(error.message); button.disabled = false; }
});

void load();
