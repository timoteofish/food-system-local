import { requireRole } from "./auth.js";
import { pool } from "../db.js";
import { localDateString, localDayBoundaryUtc } from "../local-date.js";

const validDate = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  if (year < 1000 || year > 9999) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
const getRange = (request, reply) => {
  const from = request.query?.from === undefined ? localDateString() : request.query.from;
  const to = request.query?.to === undefined ? from : request.query.to;
  if (!validDate(from) || !validDate(to) || from > to) { reply.badRequest("Invalid report date range"); return null; }
  return { from: localDayBoundaryUtc(from), to: localDayBoundaryUtc(to, true) };
};

export default async function reportRoutes(app) {
  app.get("/api/v1/businesses/:businessId/reports/sales", async (request, reply) => {
    if (!(await requireRole(request, reply))) return;
    const dates = getRange(request, reply); if (!dates) return;
    const [summary] = await pool.query("SELECT COUNT(DISTINCT o.id) AS orders, COALESCE(SUM(cm.amount), 0) AS revenue, COALESCE(AVG(cm.amount), 0) AS average_ticket FROM cash_movements cm JOIN orders o ON o.id = cm.order_id AND o.business_id = cm.business_id WHERE cm.business_id = ? AND cm.type = 'sale' AND cm.created_at >= ? AND cm.created_at < ?", [request.params.businessId, dates.from, dates.to]);
    // Split the product of two cent values into base-100000 limbs so that
    // proportional allocation stays within SQLite's signed 64-bit integers.
    const [products] = await pool.query(`
      SELECT * FROM (WITH items AS (
        SELECT o.id AS order_id, oi.id AS item_id, oi.product_id, oi.name, oi.quantity,
          CAST(ROUND(oi.total * 100) AS INTEGER) AS item_cents,
          CAST(ROUND(o.subtotal * 100) AS INTEGER) AS subtotal_cents,
          CAST(ROUND(o.discount_amount * 100) AS INTEGER) AS discount_cents
        FROM cash_movements cm
        JOIN orders o ON o.id = cm.order_id AND o.business_id = cm.business_id
        JOIN order_items oi ON oi.order_id = o.id
        WHERE cm.business_id = ? AND cm.type = 'sale' AND cm.created_at >= ? AND cm.created_at < ?
      ), limbs AS (
        SELECT *, (discount_cents / 100000) * item_cents AS high_product,
          (discount_cents % 100000) * item_cents AS low_product FROM items
      ), tails AS (
        SELECT *, CASE WHEN subtotal_cents > 0 THEN
          (high_product % subtotal_cents) * 100000 + low_product ELSE 0 END AS tail_product
        FROM limbs
      ), allocations AS (
        SELECT *, CASE WHEN subtotal_cents > 0 THEN
          (high_product / subtotal_cents) * 100000 + tail_product / subtotal_cents ELSE 0 END AS allocated_cents,
          CASE WHEN subtotal_cents > 0 THEN tail_product % subtotal_cents ELSE 0 END AS remainder
        FROM tails
      ), ranked AS (
        SELECT *, SUM(allocated_cents) OVER (PARTITION BY order_id) AS allocated_total,
          ROW_NUMBER() OVER (PARTITION BY order_id ORDER BY remainder DESC, item_id) AS position
        FROM allocations
      )
      SELECT name, SUM(quantity) AS quantity,
        SUM(item_cents - allocated_cents - CASE WHEN position <= discount_cents - allocated_total THEN 1 ELSE 0 END) / 100.0 AS revenue
      FROM ranked GROUP BY product_id, name ORDER BY quantity DESC LIMIT 20)
    `, [request.params.businessId, dates.from, dates.to]);
    return { summary: { orders: Number(summary[0].orders), revenue: Number(summary[0].revenue), average_ticket: Number(summary[0].average_ticket) }, products };
  });

  app.get("/api/v1/businesses/:businessId/reports/cash", async (request, reply) => {
    if (!(await requireRole(request, reply))) return;
    const dates = getRange(request, reply); if (!dates) return;
    const [rows] = await pool.query("SELECT type, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS movements FROM cash_movements WHERE business_id = ? AND created_at >= ? AND created_at < ? GROUP BY type", [request.params.businessId, dates.from, dates.to]);
    return { movements: rows.map((row) => ({ ...row, total: Number(row.total), movements: Number(row.movements) })) };
  });

  app.get("/api/v1/businesses/:businessId/reports/critical-stock", async (request, reply) => {
    if (!(await requireRole(request, reply))) return;
    const [items] = await pool.query(
      `SELECT ii.id, ii.name, ii.unit,
              COALESCE(SUM(CASE WHEN loc.active = TRUE AND lot.status = 'active' AND (lot.expires_at IS NULL OR lot.expires_at >= date('now','localtime')) THEN lot.current_quantity ELSE 0 END), 0) AS current_quantity,
              COALESCE(ii.minimum_quantity, 0) AS minimum_quantity
       FROM inventory_items ii
       LEFT JOIN inventory_lots lot ON lot.business_id = ii.business_id AND lot.inventory_item_id = ii.id
       LEFT JOIN inventory_locations loc ON loc.id = lot.location_id AND loc.business_id = lot.business_id
       WHERE ii.business_id = ? AND ii.active = TRUE
       GROUP BY ii.id, ii.name, ii.unit, ii.minimum_quantity
       HAVING COALESCE(SUM(CASE WHEN loc.active = TRUE AND lot.status = 'active' AND (lot.expires_at IS NULL OR lot.expires_at >= date('now','localtime')) THEN lot.current_quantity ELSE 0 END), 0) <= COALESCE(ii.minimum_quantity, 0)
       ORDER BY current_quantity`,
      [request.params.businessId]
    );
    return { items };
  });

  app.get("/api/v1/businesses/:businessId/reports/profitability", async (request, reply) => {
    if (!(await requireRole(request, reply))) return;
    const dates = getRange(request, reply); if (!dates) return;
    const [rows] = await pool.query(
      "SELECT (SELECT COALESCE(SUM(amount), 0) FROM cash_movements WHERE business_id = ? AND type = 'sale' AND created_at >= ? AND created_at < ?) AS revenue, (SELECT COALESCE(SUM(oi.quantity * pi.quantity * ii.cost_per_unit), 0) FROM orders o JOIN order_items oi ON oi.order_id = o.id LEFT JOIN product_ingredients pi ON pi.product_id = oi.product_id AND pi.business_id = o.business_id LEFT JOIN inventory_items ii ON ii.id = pi.inventory_item_id WHERE o.business_id = ? AND EXISTS (SELECT 1 FROM cash_movements cm WHERE cm.order_id = o.id AND cm.business_id = o.business_id AND cm.type = 'sale' AND cm.created_at >= ? AND cm.created_at < ?)) AS cogs",
      [request.params.businessId, dates.from, dates.to, request.params.businessId, dates.from, dates.to],
    );
    const revenue = Number(rows[0].revenue);
    const cogs = Number(rows[0].cogs);
    return { revenue, cogs, gross_profit: Number((revenue - cogs).toFixed(2)), gross_margin: revenue ? Number(((revenue - cogs) / revenue * 100).toFixed(2)) : 0 };
  });
}
