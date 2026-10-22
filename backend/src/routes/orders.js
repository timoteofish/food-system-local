import { randomUUID } from "node:crypto";
import { pool } from "../db.js";
import { requireBusinessAccess } from "./auth.js";

const statuses = new Set(["pending", "confirmed", "preparing", "ready", "completed", "cancelled"]);
const number = (value) => Number(Number(value).toFixed(2));

export default async function orderRoutes(app) {
  app.get("/api/v1/businesses/:businessId/orders/:id/print", async (request, reply) => {
    if (!(await requireBusinessAccess(request, reply))) return;
    const [orders] = await pool.query("SELECT o.id, o.status, o.total, o.created_at, t.name AS table_name FROM orders o LEFT JOIN restaurant_tables t ON t.id = o.restaurant_table_id WHERE o.id = ? AND o.business_id = ? LIMIT 1", [request.params.id, request.params.businessId]);
    if (!orders.length) return reply.notFound("Order not found");
    const [items] = await pool.query("SELECT name, quantity, unit_price, total FROM order_items WHERE order_id = ? ORDER BY created_at", [request.params.id]);
    return { ticket: { ...orders[0], total: Number(orders[0].total), items: items.map((item) => ({ ...item, quantity: Number(item.quantity), unit_price: Number(item.unit_price), total: Number(item.total) })) } };
  });

  app.get("/api/v1/businesses/:businessId/orders", async (request, reply) => {
    if (!(await requireBusinessAccess(request, reply))) return;
    const status = request.query?.status;
    const params = [request.params.businessId];
    let where = "o.business_id = ?";
    if (status) { if (!statuses.has(status)) throw app.httpErrors.badRequest("Invalid order status"); where += " AND o.status = ?"; params.push(status); }
    const [orders] = await pool.query(`SELECT o.*, t.name AS table_name, dt.status AS tab_status FROM orders o LEFT JOIN restaurant_tables t ON t.id = o.restaurant_table_id LEFT JOIN dining_tabs dt ON dt.id = o.dining_tab_id WHERE ${where} ORDER BY o.created_at DESC`, params);
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
      let diningTabId = body.dining_tab_id || null;
      if (body.table_token) {
        const [tables] = await connection.query("SELECT id FROM restaurant_tables WHERE business_id = ? AND public_token = ? AND active = TRUE LIMIT 1", [request.params.businessId, body.table_token]);
        if (!tables.length) return reply.notFound("Table not found");
        tableId = tables[0].id;
      }
      if (diningTabId) {
        const [tabs] = await connection.query("SELECT id, restaurant_table_id FROM dining_tabs WHERE id = ? AND business_id = ? AND status = 'open' LIMIT 1", [diningTabId, request.params.businessId]);
        if (!tabs.length) return reply.badRequest("Invalid or closed dining tab");
        if (tableId && tableId !== tabs[0].restaurant_table_id) return reply.badRequest("Dining tab does not belong to the selected table");
        tableId = tabs[0].restaurant_table_id;
      }
      let paymentMethodId = null;
      if (body.payment_method_id) {
        const [methods] = await connection.query("SELECT id FROM payment_methods WHERE id = ? AND business_id = ? AND active = TRUE LIMIT 1", [body.payment_method_id, request.params.businessId]);
        if (!methods.length) return reply.badRequest("Invalid payment method");
        paymentMethodId = methods[0].id;
      }
      let discountCode = null;
      let discountAmount = 0;
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
      if (body.discount_code) {
        discountCode = String(body.discount_code).trim().toUpperCase().slice(0, 40);
        const [discounts] = await connection.query("SELECT type, value FROM discounts WHERE business_id = ? AND code = ? AND active = TRUE AND (starts_at IS NULL OR starts_at <= NOW()) AND (ends_at IS NULL OR ends_at >= NOW()) LIMIT 1", [request.params.businessId, discountCode]);
        if (!discounts.length) return reply.badRequest("Invalid or expired discount code");
        discountAmount = number(Math.min(subtotal, discounts[0].type === "percentage" ? subtotal * Number(discounts[0].value) / 100 : Number(discounts[0].value)));
      }
      const total = number(subtotal - discountAmount);
      const orderId = randomUUID();
      await connection.query("INSERT INTO orders (id, business_id, restaurant_table_id, dining_tab_id, payment_method_id, subtotal, discount_code, discount_amount, total, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [orderId, request.params.businessId, tableId, diningTabId, paymentMethodId, subtotal, discountCode, discountAmount, total, String(body.order?.notes || "").slice(0, 2000) || null]);
      for (const item of items) await connection.query("INSERT INTO order_items (id, order_id, product_id, name, unit_price, quantity, total) VALUES (?, ?, ?, ?, ?, ?, ?)", [item.id, orderId, item.product_id, item.name, item.unit_price, item.quantity, item.total]);
      await connection.commit();
      return reply.code(201).send({ order: { id: orderId, business_id: request.params.businessId, restaurant_table_id: tableId, dining_tab_id: diningTabId, payment_method_id: paymentMethodId, discount_code: discountCode, discount_amount: discountAmount, status: "pending", subtotal, total, items } });
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  });

  app.patch("/api/v1/businesses/:businessId/orders/:id/update_status", async (request, reply) => {
    if (!(await requireBusinessAccess(request, reply))) return;
    const status = String(request.body?.status || "");
    if (!statuses.has(status)) return reply.badRequest("Invalid order status");
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [orders] = await connection.query("SELECT id, status FROM orders WHERE id = ? AND business_id = ? FOR UPDATE", [request.params.id, request.params.businessId]);
      if (!orders.length) {
        await connection.rollback();
        return reply.notFound("Order not found");
      }
      const current = orders[0];
      if (status === "completed" && current.status !== "completed" && current.status !== "cancelled") {
        const [items] = await connection.query("SELECT product_id, quantity FROM order_items WHERE order_id = ?", [request.params.id]);
        const requirements = new Map();
        for (const item of items) {
          const [recipe] = await connection.query("SELECT inventory_item_id, quantity FROM product_ingredients WHERE product_id = ? AND business_id = ?", [item.product_id, request.params.businessId]);
          for (const ingredient of recipe) requirements.set(ingredient.inventory_item_id, (requirements.get(ingredient.inventory_item_id) || 0) + Number(ingredient.quantity) * Number(item.quantity));
        }
        for (const [inventoryItemId, required] of requirements) {
          const [inventory] = await connection.query("SELECT current_quantity FROM inventory_items WHERE id = ? AND business_id = ? AND active = TRUE FOR UPDATE", [inventoryItemId, request.params.businessId]);
          if (!inventory.length || Number(inventory[0].current_quantity) < required) throw app.httpErrors.conflict("Insufficient inventory to complete order");
          const movementId = randomUUID();
          await connection.query("UPDATE inventory_items SET current_quantity = current_quantity - ? WHERE id = ? AND business_id = ?", [required, inventoryItemId, request.params.businessId]);
          await connection.query("INSERT INTO inventory_movements (id, business_id, inventory_item_id, order_id, type, quantity, description) VALUES (?, ?, ?, ?, 'sale', ?, ?)", [movementId, request.params.businessId, inventoryItemId, request.params.id, -required, "Baixa automática do pedido"]);
        }
      }
      await connection.query("UPDATE orders SET status = ? WHERE id = ? AND business_id = ?", [status, request.params.id, request.params.businessId]);
      if (status === "completed" && current.status !== "completed" && current.status !== "cancelled") {
        const [sales] = await connection.query("SELECT id FROM cash_movements WHERE order_id = ? AND type = 'sale' LIMIT 1", [request.params.id]);
        if (!sales.length) {
          const [totalRows] = await connection.query("SELECT total FROM orders WHERE id = ? LIMIT 1", [request.params.id]);
          await connection.query("INSERT INTO cash_movements (id, business_id, order_id, type, amount, description) VALUES (?, ?, ?, 'sale', ?, ?)", [randomUUID(), request.params.businessId, request.params.id, totalRows[0].total, "Venda concluída"]);
        }
      }
      const [rows] = await connection.query("SELECT * FROM orders WHERE id = ? LIMIT 1", [request.params.id]);
      await connection.commit();
      return { order: rows[0] };
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  });

  app.get("/api/v1/businesses/:businessId/orders/today_stats", async (request, reply) => {
    if (!(await requireBusinessAccess(request, reply))) return;
    const { params } = request;
    const [rows] = await pool.query("SELECT COUNT(*) AS orders, COALESCE(SUM(total), 0) AS total FROM orders WHERE business_id = ? AND created_at >= CURDATE() AND status <> 'cancelled'", [params.businessId]);
    return { orders: Number(rows[0].orders), total: Number(rows[0].total) };
  });
}
