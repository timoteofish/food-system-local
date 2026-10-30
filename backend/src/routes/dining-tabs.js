import { randomUUID } from "node:crypto";
import { pool } from "../db.js";
import { requireBusinessAccess } from "./auth.js";

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const validId = (value) => typeof value === "string" && value.length > 0 && value.length <= 36;

const tabView = (row) => ({
  id: row.id,
  business_id: row.business_id,
  table_id: row.restaurant_table_id,
  table_name: row.table_name,
  customer_id: row.customer_id,
  customer_name: row.customer_name,
  status: row.status,
  opened_at: row.opened_at,
  closed_at: row.closed_at,
  notes: row.notes,
  order_count: Number(row.order_count || 0),
  total: Number(row.total || 0),
});

const findOpenTab = async (businessId, tableId, connection = pool) => {
  const [rows] = await connection.query("SELECT id FROM dining_tabs WHERE business_id = ? AND restaurant_table_id = ? AND status = 'open' LIMIT 1", [businessId, tableId]);
  return rows[0] || null;
};

export default async function diningTabRoutes(app) {
  app.get("/api/v1/businesses/:businessId/dining-tabs", async (request, reply) => {
    if (!(await requireBusinessAccess(request, reply))) return;
    const [rows] = await pool.query(`SELECT t.*, rt.name AS table_name, c.name AS customer_name,
      COUNT(o.id) AS order_count, COALESCE(SUM(o.total), 0) AS total
      FROM dining_tabs t JOIN restaurant_tables rt ON rt.id = t.restaurant_table_id
      LEFT JOIN customers c ON c.id = t.customer_id
      LEFT JOIN orders o ON o.dining_tab_id = t.id AND o.status <> 'cancelled'
      WHERE t.business_id = ? GROUP BY t.id ORDER BY t.status = 'open' DESC, t.opened_at DESC`, [request.params.businessId]);
    return { tabs: rows.map(tabView) };
  });

  app.post("/api/v1/businesses/:businessId/tables/:tableId/dining-tabs", async (request, reply) => {
    if (!(await requireBusinessAccess(request, reply))) return;
    if (request.body !== undefined && !isPlainObject(request.body)) return reply.badRequest("Dining tab data must be an object");
    const customerId = request.body?.customer_id;
    if (customerId !== undefined && customerId !== null && customerId !== "" && !validId(customerId)) return reply.badRequest("Invalid customer id");
    if (request.body?.notes !== undefined && request.body.notes !== null && (typeof request.body.notes !== "string" || request.body.notes.length > 500)) return reply.badRequest("Dining tab notes must be text no longer than 500 characters");
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [tables] = await connection.query("SELECT id FROM restaurant_tables WHERE id = ? AND business_id = ? AND active = TRUE LIMIT 1 FOR UPDATE", [request.params.tableId, request.params.businessId]);
      if (!tables.length) { await connection.rollback(); return reply.notFound("Table not found"); }
      const existing = await findOpenTab(request.params.businessId, request.params.tableId, connection);
      if (existing) { await connection.rollback(); return reply.conflict("This table already has an open tab"); }
      const normalizedCustomerId = customerId || null;
      if (normalizedCustomerId) {
        const [customers] = await connection.query("SELECT id FROM customers WHERE id = ? AND business_id = ? LIMIT 1", [normalizedCustomerId, request.params.businessId]);
        if (!customers.length) { await connection.rollback(); return reply.badRequest("Customer does not belong to this business"); }
      }
      const tab = { id: randomUUID(), business_id: request.params.businessId, restaurant_table_id: request.params.tableId, customer_id: normalizedCustomerId, notes: request.body?.notes?.trim() || null };
      await connection.query("INSERT INTO dining_tabs (id, business_id, restaurant_table_id, customer_id, notes) VALUES (?, ?, ?, ?, ?)", [tab.id, tab.business_id, tab.restaurant_table_id, tab.customer_id, tab.notes]);
      await connection.commit();
      return reply.code(201).send({ tab });
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  });

  app.post("/api/v1/businesses/:businessId/dining-tabs/:tabId/transfer", async (request, reply) => {
    if (!(await requireBusinessAccess(request, reply))) return;
    const targetTableId = isPlainObject(request.body) && typeof request.body.table_id === "string" ? request.body.table_id : "";
    if (!validId(targetTableId)) return reply.badRequest("Target table is required");
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [tabs] = await connection.query("SELECT id FROM dining_tabs WHERE id = ? AND business_id = ? AND status = 'open' LIMIT 1", [request.params.tabId, request.params.businessId]);
      const [tables] = await connection.query("SELECT id FROM restaurant_tables WHERE id = ? AND business_id = ? AND active = TRUE LIMIT 1 FOR UPDATE", [targetTableId, request.params.businessId]);
      const occupied = await findOpenTab(request.params.businessId, targetTableId, connection);
      if (!tabs.length || !tables.length) { await connection.rollback(); return reply.notFound("Tab or target table not found"); }
      if (occupied && occupied.id !== request.params.tabId) { await connection.rollback(); return reply.conflict("Target table already has an open tab"); }
      await connection.query("UPDATE dining_tabs SET restaurant_table_id = ? WHERE id = ? AND business_id = ?", [targetTableId, request.params.tabId, request.params.businessId]);
      await connection.commit();
      return { tab: { id: request.params.tabId, table_id: targetTableId } };
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  });

  app.post("/api/v1/businesses/:businessId/dining-tabs/:tabId/close", async (request, reply) => {
    if (!(await requireBusinessAccess(request, reply))) return;
    const [result] = await pool.query("UPDATE dining_tabs SET status = 'closed', closed_at = CURRENT_TIMESTAMP WHERE id = ? AND business_id = ? AND status = 'open'", [request.params.tabId, request.params.businessId]);
    if (!result.affectedRows) return reply.notFound("Open tab not found");
    return { tab: { id: request.params.tabId, status: "closed" } };
  });
}
