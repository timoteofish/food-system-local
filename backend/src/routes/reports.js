import { requireBusinessAccess } from "./auth.js";
import { pool } from "../db.js";

const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
const getRange = (request, reply) => {
  const from = request.query?.from || new Date().toISOString().slice(0, 10);
  const to = request.query?.to || from;
  if (!validDate(from) || !validDate(to) || from > to) { reply.badRequest("Invalid report date range"); return null; }
  return { from: `${from} 00:00:00`, to: `${to} 23:59:59` };
};

export default async function reportRoutes(app) {
  app.get("/api/v1/businesses/:businessId/reports/sales", async (request, reply) => {
    if (!(await requireBusinessAccess(request, reply))) return;
    const dates = getRange(request, reply); if (!dates) return;
    const [summary] = await pool.query("SELECT COUNT(*) AS orders, COALESCE(SUM(total), 0) AS revenue, COALESCE(AVG(total), 0) AS average_ticket FROM orders WHERE business_id = ? AND created_at BETWEEN ? AND ? AND status <> 'cancelled'", [request.params.businessId, dates.from, dates.to]);
    const [products] = await pool.query("SELECT oi.name, SUM(oi.quantity) AS quantity, SUM(oi.total) AS revenue FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.business_id = ? AND o.created_at BETWEEN ? AND ? AND o.status <> 'cancelled' GROUP BY oi.product_id, oi.name ORDER BY quantity DESC LIMIT 20", [request.params.businessId, dates.from, dates.to]);
    return { summary: { orders: Number(summary[0].orders), revenue: Number(summary[0].revenue), average_ticket: Number(summary[0].average_ticket) }, products };
  });

  app.get("/api/v1/businesses/:businessId/reports/cash", async (request, reply) => {
    if (!(await requireBusinessAccess(request, reply))) return;
    const dates = getRange(request, reply); if (!dates) return;
    const [rows] = await pool.query("SELECT type, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS movements FROM cash_movements WHERE business_id = ? AND created_at BETWEEN ? AND ? GROUP BY type", [request.params.businessId, dates.from, dates.to]);
    return { movements: rows.map((row) => ({ ...row, total: Number(row.total), movements: Number(row.movements) })) };
  });

  app.get("/api/v1/businesses/:businessId/reports/critical-stock", async (request, reply) => {
    if (!(await requireBusinessAccess(request, reply))) return;
    const [items] = await pool.query("SELECT id, name, unit, current_quantity, minimum_quantity FROM inventory_items WHERE business_id = ? AND active = TRUE AND current_quantity <= minimum_quantity ORDER BY current_quantity", [request.params.businessId]);
    return { items };
  });
}
