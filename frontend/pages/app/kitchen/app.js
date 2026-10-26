import { getLocale, translate } from "../../../shared/i18n/i18n.js";
import { getSession } from "../../../shared/data/storage.js";
import { apiRequest } from "../../../shared/api/client.js";
import { initAppShell } from "../../../shared/ui/ui.js";

const session = getSession();
const board = document.getElementById("kitchenBoard");
const statusMessage = document.getElementById("kitchenStatus");
const stationSelect = document.getElementById("kitchenStation");
const refreshButton = document.getElementById("refreshKitchen");
const columns = [
  ["pending", "Novos", "confirmed"],
  ["confirmed", "Aguardando preparo", "preparing"],
  ["preparing", "Em preparo", "ready"],
  ["ready", "Prontos", "completed"],
];
const activeKitchenStatuses = new Set(columns.map(([status]) => status));
const actionLabels = {
  confirmed: "Confirmar pedido",
  preparing: "Iniciar preparo",
  ready: "Marcar como pronto",
  completed: "Concluir pedido",
};
const escapeHtml = (value) => String(value ?? "").replace(/[&<>\'"]/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "'": "&#39;",
  '"': "&quot;",
}[char]));
const orderCode = (order) => String(order.id || "").slice(-6).toUpperCase();
const formatTicketPrice = (value) => Number(value || 0).toLocaleString(getLocale(), { style: "currency", currency: "BRL" });
const printStyles = `
  @page { margin: 10mm; }
  body { width: 280px; margin: 20px auto; font: 13px ui-monospace, SFMono-Regular, Consolas, monospace; color: #111; }
  h1 { text-align: center; font-size: 18px; }
  hr { border: 0; border-top: 1px dashed #111; }
  p { display: flex; justify-content: space-between; gap: 10px; }
  button { display: none; }
`;
const printCopy = getLocale().startsWith("en")
  ? { order: "Order", tableOrCounter: "Table or counter", counter: "Counter", total: "Total" }
  : { order: "Pedido", tableOrCounter: "Mesa ou balcão", counter: "Balcão", total: "Total" };

const setStatus = (message, state = "") => {
  statusMessage.textContent = message;
  if (state) statusMessage.dataset.state = state;
  else statusMessage.removeAttribute("data-state");
};

const openPrintTicket = (ticket) => {
  const popup = window.open("", "_blank", "width=420,height=640");
  if (!popup) {
    setStatus(translate("Não foi possível abrir a impressão Permita janelas para este aplicativo e tente novamente"), "error");
    return;
  }

  const orderItems = (ticket.items || []).map((item) => (
    `<p><span>${escapeHtml(item.quantity)} × ${escapeHtml(item.name)}</span><span>${formatTicketPrice(item.total)}</span></p>`
  )).join("");
  const ticketMarkup = `
    <!doctype html>
    <html lang="${getLocale()}">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>${printCopy.order} ${escapeHtml(String(ticket.id || "").slice(-6))}</title>
        <style>${printStyles}</style>
      </head>
      <body>
        <h1>Food System</h1>
        <p><span>${printCopy.order}</span><span>#${escapeHtml(String(ticket.id || "").slice(-6))}</span></p>
        <p><span>${printCopy.tableOrCounter}</span><span>${escapeHtml(ticket.table_name || printCopy.counter)}</span></p>
        <hr />
        ${orderItems}
        <hr />
        <p><strong>${printCopy.total}</strong><strong>${formatTicketPrice(ticket.total)}</strong></p>
        <script>window.print();</script>
      </body>
    </html>
  `;

  popup.document.write(ticketMarkup);
  popup.document.close();
};

const renderBoard = (orders) => {
  board.innerHTML = columns.map(([status, label, next]) => {
    const matchingOrders = orders.filter((order) => order.status === status);
    const orderCountLabel = translate(matchingOrders.length === 1 ? "$1 pedido" : "$1 pedidos")
      .replace("$1", String(matchingOrders.length));
    const tickets = matchingOrders.map((order) => {
      const items = (order.items || []).map((item) => (
        `<li><strong>${escapeHtml(item.quantity)} ×</strong>${escapeHtml(item.name)}</li>`
      )).join("");
      return `
        <article class="kitchen-ticket">
          <div class="kitchen-ticket__head">
            <strong class="kitchen-ticket__code">#${escapeHtml(orderCode(order))}</strong>
            <span class="kitchen-ticket__location">${escapeHtml(order.table_name || translate("Balcão"))}</span>
          </div>
          <ul class="kitchen-ticket__items">${items || `<li>${translate("Itens não informados")}</li>`}</ul>
          <div class="kitchen-ticket__actions">
            <button class="btn btn--primary" data-order-id="${escapeHtml(order.id)}" data-next-status="${next}" type="button">${escapeHtml(translate(actionLabels[next]))}</button>
            <button class="btn btn--secondary" data-print-order="${escapeHtml(order.id)}" type="button">${translate("Imprimir comanda")}</button>
          </div>
        </article>
      `;
    }).join("");
    return `
      <section class="kitchen-column" data-status="${status}" aria-labelledby="kitchen-${status}">
        <div class="kitchen-column__head">
          <h2 id="kitchen-${status}">${translate(label)}</h2>
          <span class="kitchen-column__count" aria-label="${orderCountLabel}">${matchingOrders.length}</span>
        </div>
        ${tickets || `<p class="kitchen-column__empty">${translate("Nenhum pedido nesta etapa")}</p>`}
      </section>
    `;
  }).join("");
};

const load = async () => {
  board.setAttribute("aria-busy", "true");
  setStatus(translate("Atualizando pedidos"));
  refreshButton.disabled = true;
  const stationQuery = stationSelect.value ? `?station_id=${encodeURIComponent(stationSelect.value)}` : "";

  try {
    const data = await apiRequest(`/businesses/${session.businessId}/orders${stationQuery}`);
    const orders = Array.isArray(data.orders) ? data.orders : [];
    renderBoard(orders);
    const activeCount = orders.filter((order) => activeKitchenStatuses.has(order.status)).length;
    const countLabel = translate(activeCount === 1 ? "$1 pedido ativo" : "$1 pedidos ativos")
      .replace("$1", String(activeCount));
    setStatus(countLabel);
  } catch (error) {
    board.innerHTML = `<div class="kitchen-board__error" role="alert"><p>${translate("Não foi possível carregar os pedidos Verifique a conexão e tente novamente.")}</p><button class="btn btn--secondary" type="button" data-kitchen-retry>${translate("Tentar novamente")}</button></div>`;
    setStatus(translate("Pedidos indisponíveis"), "error");
  } finally {
    board.setAttribute("aria-busy", "false");
    refreshButton.disabled = false;
  }
};

board.addEventListener("click", async (event) => {
  const printButton = event.target.closest("[data-print-order]");
  if (printButton) {
    printButton.disabled = true;
    try {
      const orderId = printButton.dataset.printOrder;
      await apiRequest(`/businesses/${session.businessId}/orders/${orderId}/print-jobs`, {
        method: "POST",
        body: { station_id: stationSelect.value || null },
      });
      const data = await apiRequest(`/businesses/${session.businessId}/orders/${orderId}/print`);
      openPrintTicket(data.ticket);
    } catch (error) {
      setStatus(translate("Não foi possível preparar a impressão Tente novamente"), "error");
    } finally {
      printButton.disabled = false;
    }
    return;
  }

  const button = event.target.closest("[data-order-id]");
  if (!button) return;
  button.disabled = true;
  try {
    await apiRequest(`/businesses/${session.businessId}/orders/${button.dataset.orderId}/update_status`, {
      method: "PATCH",
      body: { status: button.dataset.nextStatus },
    });
    await load();
  } catch (error) {
    setStatus(translate("Não foi possível atualizar o pedido Tente novamente"), "error");
    button.disabled = false;
  }
});

let appShellReady = false;
let stationsLoaded = false;
let initializing = false;

const initializeKitchen = async () => {
  if (initializing) return;
  initializing = true;
  refreshButton.disabled = true;
  try {
    if (!appShellReady) {
      await initAppShell({ activeNav: "kitchen" });
      appShellReady = true;
    }
    if (!stationsLoaded) {
      try {
        const stationData = await apiRequest(`/businesses/${session.businessId}/kitchen-stations`);
        const allStationsOption = stationSelect.options[0];
        stationSelect.replaceChildren(allStationsOption);
        for (const station of (stationData.stations || []).filter((item) => item.active !== false)) {
          const option = document.createElement("option");
          option.value = station.id;
          option.textContent = station.name;
          stationSelect.append(option);
        }
        stationSelect.disabled = false;
        stationsLoaded = true;
      } catch {
        stationSelect.disabled = true;
        stationSelect.title = translate("Não foi possível carregar as estações");
      }
    }
    await load();
  } catch {
    board.setAttribute("aria-busy", "false");
    board.innerHTML = `<div class="kitchen-board__error" role="alert"><p>${translate("Não foi possível abrir a cozinha.")}</p><button class="btn btn--secondary" type="button" data-kitchen-retry>${translate("Tentar novamente")}</button></div>`;
    setStatus(translate("Pedidos indisponíveis"), "error");
  } finally {
    initializing = false;
    refreshButton.disabled = false;
  }
};

refreshButton.addEventListener("click", () => void initializeKitchen());
stationSelect.addEventListener("change", load);
board.addEventListener("click", (event) => {
  if (event.target.closest("[data-kitchen-retry]")) void initializeKitchen();
});

void initializeKitchen();
