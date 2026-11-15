import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import portuguese from "../../frontend/shared/i18n/locales/pt.js";

const auth = await readFile("../frontend/shared/auth/auth.js", "utf8");
const cashier = await readFile("../frontend/pages/app/cashier/app.js", "utf8");
const orderPage = await readFile("../frontend/pages/app/orders/app.js", "utf8");
const between = (source, start, end) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Could not find ${start}`);
  return source.slice(from, to).replaceAll("export const ", "const ");
};

test("order interface sends and displays API completion status correctly", async () => {
  const functions = between(auth, "export const loadOrdersRemote", "const extractTableName") + between(auth, "const normalizeOrderStatus", "export const loadDashboardData");
  const sent = [];
  const context = {
    requireBusinessId: () => "business", fetchOrders: async () => [{ id: "a", status: "completed" }, { id: "b", status: "out_for_delivery" }],
    updateOrderStatusRequest: async (_business, id, status) => { sent.push(status); return { id, status }; },
    extractPaymentMethod: () => "cash", extractTableName: () => "table", formatOrderLocation: () => "table", translate: (value) => value,
  };
  vm.runInNewContext(`${functions}\nglobalThis.run = async () => ({ orders: await loadOrdersRemote(), updated: await updateOrderStatusRemote('a', 'completed') });`, context);
  const result = await context.run();
  assert.deepEqual(sent, ["completed"]);
  assert.equal(result.updated.status, "completed");
  assert.equal(result.orders[0].status, "completed");
  assert.equal(result.orders[1].status, "out_for_delivery");
});

test("orders in delivery remain visible and can be completed", () => {
  const statuses = between(orderPage, "const ACTIVE_STATUSES", "const mobileOrdersQuery");
  const rendering = between(orderPage, "const getStatusLabel", "const groupOrdersByLocation");
  const context = { translate: (key) => key, escapeHtml: (value) => String(value) };
  vm.runInNewContext(`${statuses}\n${rendering}\nglobalThis.check = (order) => ({ active: isActiveOrder(order), label: getStatusLabel(order.status), actions: getOrderActions(order) });`, context);
  const result = context.check({ id: "order", status: "out_for_delivery" });
  assert.equal(result.active, true);
  assert.equal(result.label, "ordersStatusOutForDelivery");
  assert.match(result.actions, /data-order-action="completed"/);
  assert.equal(portuguese.ordersStatusOutForDelivery, "Em entrega ou aguardando conclusão");
});

test("cashier excludes cancelled and completed orders from pending counter payments", async () => {
  const load = between(auth, "export const loadCashierData", "export const addCashMovementRemote");
  const pending = between(cashier, "const getPendingCounterPayments", "const renderSummary");
  const context = {
    requireBusinessId: () => "business", fetchOrders: async () => ["pending", "completed", "cancelled"].map((status) => ({ id: status, status })),
    fetchCashMovements: async () => ({ movements: [], balance: 0 }), extractPaymentMethod: () => "counter",
    PAYMENT_METHODS: { CASH_AT_COUNTER: "counter" }, extractTableName: () => "table", formatOrderLocation: () => "table", translate: (value) => value,
  };
  vm.runInNewContext(`${load}\nlet orders = [];\n${pending}\nglobalThis.run = async () => { orders = (await loadCashierData()).orders; return getPendingCounterPayments().map((order) => order.id); };`, context);
  assert.deepEqual(Array.from(await context.run()), ["pending"]);
});

test("cashier copy does not claim that order completion verifies payment", () => {
  assert.equal(portuguese.cashConfirmPayment, "Concluir pedido");
  assert.match(portuguese.cashConfirmOrderPayment, /não verifica nem registra o recebimento/);
  assert.match(portuguese.cashPaymentCompleted, /não verificou o pagamento/);
});

test("dashboard combines active locations with recent orders and today's totals", async () => {
  const dashboard = between(auth, "export const loadDashboardData", "export const loadCashierData");
  const requested = [];
  const context = {
    requireBusinessId: () => "business",
    fetchTodayStats: async () => ({ total_revenue: 12.5, total_orders: 4 }),
    fetchOrders: async (_business, options) => {
      requested.push(options.activeOnly ? "active" : options.recentOnly ? "recent" : "all");
      return options.activeOnly
        ? [{ status: "pending", table_name: "Mesa 1" }, { status: "ready", table_name: "mesa 1" }, { status: "preparing", table_name: "Mesa 2" }]
        : [{ id: "recent", created_at: "2026-01-02T00:00:00Z", total: 7, items: [{ name: "Meal" }] }, { id: "older", created_at: "2026-01-01T00:00:00Z", total: 5 }];
    },
    loadProducts: async () => [{ active: true }, { active: false }],
    formatOrderLocation: (value) => value || "", extractTableName: () => "", translate: (value) => value,
    getLocale: () => "pt-BR", parseApiTimestamp: (value) => new Date(value),
  };
  vm.runInNewContext(`${dashboard}\nglobalThis.run = loadDashboardData;`, context);
  const result = await context.run();
  assert.deepEqual(requested.sort(), ["active", "recent"]);
  assert.equal(result.stats.activeProducts, 1);
  assert.equal(result.stats.activeLocations, 2);
  assert.equal(result.stats.ordersToday, 4);
  assert.equal(result.stats.ordersValueToday, 12.5);
  assert.deepEqual(Array.from(result.orders, ({ id }) => id), ["recent", "older"]);
});
