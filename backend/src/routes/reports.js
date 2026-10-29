import { requireRole } from "./auth.js";
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
    if (!(await requireRole(request, reply))) return;
    const dates = getRange(request, reply); if (!dates) return;
    const [summary] = await pool.query("SELECT COUNT(DISTINCT o.id) AS orders, COALESCE(SUM(cm.amount), 0) AS revenue, COALESCE(AVG(cm.amount), 0) AS average_ticket FROM cash_movements cm JOIN orders o ON o.id = cm.order_id AND o.business_id = cm.business_id WHERE cm.business_id = ? AND cm.type = 'sale' AND cm.created_at BETWEEN ? AND ?", [request.params.businessId, dates.from, dates.to]);
    const [products] = await pool.query("SELECT oi.name, SUM(oi.quantity) AS quantity, SUM(oi.total - CASE WHEN o.subtotal > 0 THEN oi.total / o.subtotal * o.discount_amount ELSE 0 END) AS revenue FROM cash_movements cm JOIN orders o ON o.id = cm.order_id AND o.business_id = cm.business_id JOIN order_items oi ON oi.order_id = o.id WHERE cm.business_id = ? AND cm.type = 'sale' AND cm.created_at BETWEEN ? AND ? GROUP BY oi.product_id, oi.name ORDER BY quantity DESC LIMIT 20", [request.params.businessId, dates.from, dates.to]);
    return { summary: { orders: Number(summary[0].orders), revenue: Number(summary[0].revenue), average_ticket: Number(summary[0].average_ticket) }, products };
  });

  app.get("/api/v1/businesses/:businessId/reports/cash", async (request, reply) => {
    if (!(await requireRole(request, reply))) return;
    const dates = getRange(request, reply); if (!dates) return;
    const [rows] = await pool.query("SELECT type, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS movements FROM cash_movements WHERE business_id = ? AND created_at BETWEEN ? AND ? GROUP BY type", [request.params.businessId, dates.from, dates.to]);
    return { movements: rows.map((row) => ({ ...row, total: Number(row.total), movements: Number(row.movements) })) };
  });

  app.get("/api/v1/businesses/:businessId/reports/critical-stock", async (request, reply) => {
    if (!(await requireRole(request, reply))) return;
    const [items] = await pool.query("SELECT id, name, unit, current_quantity, minimum_quantity FROM inventory_items WHERE business_id = ? AND active = TRUE AND current_quantity <= minimum_quantity ORDER BY current_quantity", [request.params.businessId]);
    return { items };
  });

  app.get("/api/v1/businesses/:businessId/reports/profitability", async (request, reply) => {
    if (!(await requireRole(request, reply))) return;
    const dates = getRange(request, reply); if (!dates) return;
    const [rows] = await pool.query(
      "SELECT (SELECT COALESCE(SUM(amount), 0) FROM cash_movements WHERE business_id = ? AND type = 'sale' AND created_at BETWEEN ? AND ?) AS revenue, (SELECT COALESCE(SUM(oi.quantity * pi.quantity * ii.cost_per_unit), 0) FROM orders o JOIN order_items oi ON oi.order_id = o.id LEFT JOIN product_ingredients pi ON pi.product_id = oi.product_id AND pi.business_id = o.business_id LEFT JOIN inventory_items ii ON ii.id = pi.inventory_item_id WHERE o.business_id = ? AND EXISTS (SELECT 1 FROM cash_movements cm WHERE cm.order_id = o.id AND cm.business_id = o.business_id AND cm.type = 'sale' AND cm.created_at BETWEEN ? AND ?)) AS cogs",
      [request.params.businessId, dates.from, dates.to, request.params.businessId, dates.from, dates.to],
    );
    const revenue = Number(rows[0].revenue);
    const cogs = Number(rows[0].cogs);
    return { revenue, cogs, gross_profit: Number((revenue - cogs).toFixed(2)), gross_margin: revenue ? Number(((revenue - cogs) / revenue * 100).toFixed(2)) : 0 };
  });
}
