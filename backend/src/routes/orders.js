import { randomUUID } from "node:crypto";
import { pool } from "../db.js";
import { requireBusinessAccess } from "./auth.js";

const statuses = new Set(["pending", "confirmed", "preparing", "ready", "completed", "cancelled"]);
const number = (value) => Number(Number(value).toFixed(2));

export default async function orderRoutes(app) {
  app.get("/api/v1/businesses/:businessId/orders", async (request, reply) => {
    if (!(await requireBusinessAccess(request, reply))) return;
    const status = request.query?.status;
    const params = [request.params.businessId];
    let where = "o.business_id = ?";
    if (status) { if (!statuses.has(status)) throw app.httpErrors.badRequest("Invalid order status"); where += " AND o.status = ?"; params.push(status); }
    const [orders] = await pool.query(`SELECT o.*, t.name AS table_name FROM orders o LEFT JOIN restaurant_tables t ON t.id = o.restaurant_table_id WHERE ${where} ORDER BY o.created_at DESC`, params);
    for (const order of orders) {
      const [items] = await pool.query("SELECT * FROM order_items WHERE order_id = ? ORDER BY created_at", [order.id]);
      order.items = items;
    }
    return { orders };
  });

  app.post("/api/v1/businesses/:businessId/orders", async (request, reply) => {
    const body = request.body || {};
    const inputItems = Array.isArray(body.items) ? body.items : [];
    if (!inputItems.length) return reply.badRequest("At least one order item is required");
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      let tableId = null;
      if (body.table_token) {
        const [tables] = await connection.query("SELECT id FROM restaurant_tables WHERE business_id = ? AND public_token = ? AND active = TRUE LIMIT 1", [request.params.businessId, body.table_token]);
        if (!tables.length) return reply.notFound("Table not found");
        tableId = tables[0].id;
      }
      const ids = inputItems.map((item) => item.product_id || item.id).filter(Boolean);
      if (!ids.length || ids.length !== inputItems.length) return reply.badRequest("Each item must include a product id");
      const placeholders = ids.map(() => "?").join(",");
      const [products] = await connection.query(`SELECT id, name, price, active FROM products WHERE business_id = ? AND id IN (${placeholders})`, [request.params.businessId, ...ids]);
      const byId = new Map(products.map((product) => [product.id, product]));
      const items = inputItems.map((item) => {
        const product = byId.get(item.product_id || item.id);
        const quantity = Number(item.quantity);
        if (!product || !product.active || !Number.isFinite(quantity) || quantity <= 0 || quantity > 999) throw app.httpErrors.badRequest("Invalid product or quantity");
        return { id: randomUUID(), product_id: product.id, name: product.name, unit_price: number(product.price), quantity, total: number(product.price * quantity) };
      });
      const subtotal = number(items.reduce((sum, item) => sum + item.total, 0));
      const orderId = randomUUID();
      await connection.query("INSERT INTO orders (id, business_id, restaurant_table_id, subtotal, total, notes) VALUES (?, ?, ?, ?, ?, ?)", [orderId, request.params.businessId, tableId, subtotal, subtotal, String(body.order?.notes || "").slice(0, 2000) || null]);
      for (const item of items) await connection.query("INSERT INTO order_items (id, order_id, product_id, name, unit_price, quantity, total) VALUES (?, ?, ?, ?, ?, ?, ?)", [item.id, orderId, item.product_id, item.name, item.unit_price, item.quantity, item.total]);
      await connection.commit();
      return reply.code(201).send({ order: { id: orderId, business_id: request.params.businessId, restaurant_table_id: tableId, status: "pending", subtotal, total: subtotal, items } });
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  });

  app.patch("/api/v1/businesses/:businessId/orders/:id/update_status", async (request, reply) => {
    if (!(await requireBusinessAccess(request, reply))) return;
    const status = String(request.body?.status || "");
    if (!statuses.has(status)) return reply.badRequest("Invalid order status");
    const [result] = await pool.query("UPDATE orders SET status = ? WHERE id = ? AND business_id = ?", [status, request.params.id, request.params.businessId]);
    if (!result.affectedRows) return reply.notFound("Order not found");
    const [rows] = await pool.query("SELECT * FROM orders WHERE id = ? LIMIT 1", [request.params.id]);
    return { order: rows[0] };
  });

  app.get("/api/v1/businesses/:businessId/orders/today_stats", async (request, reply) => {
    if (!(await requireBusinessAccess(request, reply))) return;
    const { params } = request;
    const [rows] = await pool.query("SELECT COUNT(*) AS orders, COALESCE(SUM(total), 0) AS total FROM orders WHERE business_id = ? AND created_at >= CURDATE() AND status <> 'cancelled'", [params.businessId]);
    return { orders: Number(rows[0].orders), total: Number(rows[0].total) };
  });
}
