import { createHash, randomUUID } from "node:crypto";
import { pool } from "../db.js";
import { requireBusinessAccess, requireRole } from "./auth.js";
import { audit } from "../audit.js";
import { canTransitionOrderStatus } from "../order-status.js";
import { hasDecimalScale, toMinorUnits } from "../numbers.js";

const statuses = new Set(["pending", "confirmed", "preparing", "ready", "out_for_delivery", "completed", "cancelled"]);
const number = (value) => Number(Number(value).toFixed(2));
const MAX_ORDER_AMOUNT = 99999999.99;
const MAX_ORDER_ITEMS = 100;
const MAX_PAYMENT_ALLOCATIONS = 20;
const validId = (value) => typeof value === "string" && value.length > 0 && value.length <= 36;
const validTableToken = (value) => typeof value === "string" && /^[0-9a-f]{48}$/i.test(value);
const validIdempotencyKey = (value) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export default async function orderRoutes(app) {
  app.post("/api/v1/businesses/:businessId/orders/:id/print-jobs", async (request, reply) => {
    const user = await requireRole(request, reply);
    if (!user) return;
    const stationId = request.body?.station_id || null;
    const [orders] = await pool.query("SELECT o.id, o.total, o.status, t.name AS table_name FROM orders o LEFT JOIN restaurant_tables t ON t.id = o.restaurant_table_id WHERE o.id = ? AND o.business_id = ? LIMIT 1", [request.params.id, request.params.businessId]);
    if (!orders.length) return reply.notFound("Order not found");
    if (stationId) {
      const [stations] = await pool.query("SELECT id FROM kitchen_stations WHERE id = ? AND business_id = ? AND active = TRUE LIMIT 1", [stationId, request.params.businessId]);
      if (!stations.length) return reply.badRequest("Kitchen station not found");
    }
    const [items] = await pool.query("SELECT name, quantity, unit_price, total FROM order_items WHERE order_id = ? ORDER BY created_at", [request.params.id]);
    const payload = { order: orders[0], items };
    const id = randomUUID();
    await pool.query("INSERT INTO print_jobs (id, business_id, order_id, station_id, job_type, payload) VALUES (?, ?, ?, ?, 'kitchen_ticket', ?)", [id, request.params.businessId, request.params.id, stationId, JSON.stringify(payload)]);
    await audit(request, user, "print_job.queued", "print_job", id, { order_id: request.params.id, station_id: stationId });
    return reply.code(202).send({ job: { id, status: "queued", order_id: request.params.id, station_id: stationId } });
  });

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
    const stationId = request.query?.station_id;
    const params = [request.params.businessId];
    let where = "o.business_id = ?";
    if (status) { if (!statuses.has(status)) throw app.httpErrors.badRequest("Invalid order status"); where += " AND o.status = ?"; params.push(status); }
    if (stationId) { where += " AND EXISTS (SELECT 1 FROM order_items soi JOIN products sop ON sop.id = soi.product_id WHERE soi.order_id = o.id AND sop.kitchen_station_id = ? AND sop.business_id = ?)"; params.push(stationId, request.params.businessId); }
    const [orders] = await pool.query(`SELECT o.*, t.name AS table_name, dt.status AS tab_status FROM orders o LEFT JOIN restaurant_tables t ON t.id = o.restaurant_table_id LEFT JOIN dining_tabs dt ON dt.id = o.dining_tab_id WHERE ${where} ORDER BY COALESCE(o.scheduled_for, o.created_at) DESC`, params);
    for (const order of orders) {
      const [items] = await pool.query("SELECT * FROM order_items WHERE order_id = ? ORDER BY created_at", [order.id]);
      order.items = items;
      const [payments] = await pool.query("SELECT op.*, pm.name AS payment_method_name FROM order_payments op JOIN payment_methods pm ON pm.id = op.payment_method_id WHERE op.order_id = ? ORDER BY op.created_at", [order.id]);
      order.payments = payments;
    }
    return { orders };
  });

  app.post("/api/v1/businesses/:businessId/orders", async (request, reply) => {
    const body = request.body || {};
    const inputItems = Array.isArray(body.items) ? body.items : [];
    if (!inputItems.length) return reply.badRequest("At least one order item is required");
    if (inputItems.length > MAX_ORDER_ITEMS || inputItems.some((item) => !item || typeof item !== "object" || Array.isArray(item))) return reply.badRequest(`Orders may contain at most ${MAX_ORDER_ITEMS} valid items`);
    if (body.payments !== undefined && !Array.isArray(body.payments)) return reply.badRequest("Payments must be an array");
    if (Array.isArray(body.payments) && (body.payments.length > MAX_PAYMENT_ALLOCATIONS || body.payments.some((payment) => !payment || typeof payment !== "object" || Array.isArray(payment)))) return reply.badRequest(`Orders may contain at most ${MAX_PAYMENT_ALLOCATIONS} valid payment allocations`);
    if (body.table_token !== undefined && body.table_token !== "" && !validTableToken(body.table_token)) return reply.badRequest("Invalid table token");
    if (body.dining_tab_id !== undefined && body.dining_tab_id !== null && body.dining_tab_id !== "" && !validId(body.dining_tab_id)) return reply.badRequest("Invalid dining tab id");
    if (body.payment_method_id !== undefined && body.payment_method_id !== null && body.payment_method_id !== "" && !validId(body.payment_method_id)) return reply.badRequest("Invalid payment method id");
    if (body.customer_id !== undefined && body.customer_id !== null && body.customer_id !== "" && !validId(body.customer_id)) return reply.badRequest("Invalid customer id");
    if (!validIdempotencyKey(body.idempotency_key)) return reply.badRequest("A valid idempotency key is required");
    const idempotencyKey = body.idempotency_key;
    const requestHash = createHash("sha256").update(JSON.stringify({ business_id: request.params.businessId, body })).digest("hex");
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      let tableId = null;
      let diningTabId = body.dining_tab_id || null;
      if (body.table_token) {
        const [tables] = await connection.query("SELECT id FROM restaurant_tables WHERE business_id = ? AND public_token = ? AND active = TRUE LIMIT 1", [request.params.businessId, body.table_token]);
        if (!tables.length) { await connection.rollback(); return reply.notFound("Table not found"); }
        tableId = tables[0].id;
      }
      if (diningTabId) {
        const [tabs] = await connection.query("SELECT id, restaurant_table_id FROM dining_tabs WHERE id = ? AND business_id = ? AND status = 'open' LIMIT 1", [diningTabId, request.params.businessId]);
        if (!tabs.length) { await connection.rollback(); return reply.badRequest("Invalid or closed dining tab"); }
        if (tableId && tableId !== tabs[0].restaurant_table_id) { await connection.rollback(); return reply.badRequest("Dining tab does not belong to the selected table"); }
        tableId = tabs[0].restaurant_table_id;
      }
      let paymentMethodId = null;
      if (body.payment_method_id) {
        const [methods] = await connection.query("SELECT id FROM payment_methods WHERE id = ? AND business_id = ? AND active = TRUE LIMIT 1", [body.payment_method_id, request.params.businessId]);
        if (!methods.length) { await connection.rollback(); return reply.badRequest("Invalid payment method"); }
        paymentMethodId = methods[0].id;
      }
      const delivery = body.delivery && typeof body.delivery === "object" ? body.delivery : null;
      const deliveryAddress = delivery?.address && typeof delivery.address === "object" ? delivery.address : null;
      const [businessRows] = await connection.query("SELECT settings FROM businesses WHERE id = ? LIMIT 1", [request.params.businessId]);
      if (!businessRows.length) { await connection.rollback(); return reply.notFound("Business not found"); }
      let businessSettings = businessRows[0].settings;
      if (typeof businessSettings === "string") {
        try { businessSettings = JSON.parse(businessSettings); } catch { businessSettings = {}; }
      }
      const configuredDeliveryFee = Number(businessSettings?.delivery_fee ?? 0);
      if (!Number.isFinite(configuredDeliveryFee) || configuredDeliveryFee < 0 || configuredDeliveryFee > MAX_ORDER_AMOUNT || !hasDecimalScale(configuredDeliveryFee, 2)) {
        await connection.rollback();
        return reply.code(500).send({ error: "Business delivery fee configuration is invalid" });
      }
      const deliveryFee = deliveryAddress ? configuredDeliveryFee : 0;
      if (delivery && !deliveryAddress) { await connection.rollback(); return reply.badRequest("Invalid delivery details; address is required"); }
      if (deliveryAddress && (!String(deliveryAddress.street || "").trim() || !String(deliveryAddress.number || "").trim() || !String(deliveryAddress.city || "").trim())) { await connection.rollback(); return reply.badRequest("Delivery address is incomplete"); }
      const customerName = typeof body.order?.customer_name === "string" ? body.order.customer_name.trim().slice(0, 160) : "";
      let customerId = body.customer_id || null;
      if (customerId) {
        const [customers] = await connection.query("SELECT id FROM customers WHERE id = ? AND business_id = ? LIMIT 1", [customerId, request.params.businessId]);
        if (!customers.length) { await connection.rollback(); return reply.badRequest("Customer does not belong to this business"); }
      }
      const scheduledFor = delivery?.scheduled_for ? new Date(delivery.scheduled_for) : null;
      if (scheduledFor && Number.isNaN(scheduledFor.getTime())) { await connection.rollback(); return reply.badRequest("Invalid scheduled delivery date"); }
      let discountCode = null;
      let discountAmount = 0;
      const ids = inputItems.map((item) => item.product_id || item.id);
      if (ids.some((id) => !validId(id))) { await connection.rollback(); return reply.badRequest("Each item must include a valid product id"); }
      const placeholders = ids.map(() => "?").join(",");
      const [products] = await connection.query(`SELECT id, name, price, active FROM products WHERE business_id = ? AND id IN (${placeholders})`, [request.params.businessId, ...ids]);
      const byId = new Map(products.map((product) => [product.id, product]));
      const items = inputItems.map((item) => {
        const product = byId.get(item.product_id || item.id);
        const quantity = Number(item.quantity);
        if (!product || !product.active || !hasDecimalScale(item.quantity, 2) || quantity <= 0 || quantity > 999) throw app.httpErrors.badRequest("Invalid product or quantity; quantity must have at most 2 decimal places");
        const total = number(product.price * quantity);
        if (total > MAX_ORDER_AMOUNT) throw app.httpErrors.badRequest("Order item exceeds the maximum supported amount");
        return { id: randomUUID(), product_id: product.id, name: product.name, unit_price: number(product.price), quantity, total };
      });
      const subtotal = number(items.reduce((sum, item) => sum + item.total, 0));
      if (subtotal > MAX_ORDER_AMOUNT) { await connection.rollback(); return reply.badRequest("Order subtotal exceeds the maximum supported amount"); }
      if (body.discount_code) {
        discountCode = String(body.discount_code).trim().toUpperCase().slice(0, 40);
        const [discounts] = await connection.query("SELECT type, value FROM discounts WHERE business_id = ? AND code = ? AND active = TRUE AND (starts_at IS NULL OR starts_at <= NOW()) AND (ends_at IS NULL OR ends_at >= NOW()) LIMIT 1", [request.params.businessId, discountCode]);
        if (!discounts.length) { await connection.rollback(); return reply.badRequest("Invalid or expired discount code"); }
        discountAmount = number(Math.min(subtotal, discounts[0].type === "percentage" ? subtotal * Number(discounts[0].value) / 100 : Number(discounts[0].value)));
      }
      const total = number(subtotal - discountAmount + deliveryFee);
      if (total > MAX_ORDER_AMOUNT) { await connection.rollback(); return reply.badRequest("Order total exceeds the maximum supported amount"); }
      const paymentInputs = Array.isArray(body.payments) ? body.payments : [];
      if (paymentInputs.length) {
        const paymentIds = paymentInputs.map((payment) => payment.payment_method_id).filter(Boolean);
        const paymentCents = paymentInputs.map((payment) => toMinorUnits(payment.amount));
        const paidCents = paymentCents.reduce((sum, amount) => sum + amount, 0);
        if (paymentIds.length !== paymentInputs.length || paymentIds.some((id) => !validId(id)) || new Set(paymentIds).size !== paymentIds.length || paymentInputs.some((payment) => !hasDecimalScale(payment.amount, 2) || Number(payment.amount) <= 0 || Number(payment.amount) > MAX_ORDER_AMOUNT) || !Number.isSafeInteger(paidCents) || paidCents !== toMinorUnits(total)) { await connection.rollback(); return reply.badRequest("Payment allocations must use cents and equal the order total"); }
        const [methods] = await connection.query(`SELECT id FROM payment_methods WHERE business_id = ? AND active = TRUE AND id IN (${paymentIds.map(() => "?").join(",")})`, [request.params.businessId, ...paymentIds]);
        if (methods.length !== paymentIds.length) { await connection.rollback(); return reply.badRequest("Invalid payment method"); }
      }
      const orderId = randomUUID();
      await connection.query("INSERT INTO orders (id, business_id, idempotency_key, idempotency_hash, restaurant_table_id, dining_tab_id, customer_id, customer_name, delivery_address, delivery_fee, scheduled_for, payment_method_id, subtotal, discount_code, discount_amount, total, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [orderId, request.params.businessId, idempotencyKey, requestHash, tableId, diningTabId, customerId, customerName || null, deliveryAddress ? JSON.stringify(deliveryAddress) : null, deliveryFee, scheduledFor ? scheduledFor : null, paymentMethodId, subtotal, discountCode, discountAmount, total, String(body.order?.notes || "").slice(0, 2000) || null]);
      for (const item of items) await connection.query("INSERT INTO order_items (id, order_id, product_id, name, unit_price, quantity, total) VALUES (?, ?, ?, ?, ?, ?, ?)", [item.id, orderId, item.product_id, item.name, item.unit_price, item.quantity, item.total]);
      for (const payment of paymentInputs) await connection.query("INSERT INTO order_payments (id, business_id, order_id, payment_method_id, amount) VALUES (?, ?, ?, ?, ?)", [randomUUID(), request.params.businessId, orderId, payment.payment_method_id, (toMinorUnits(payment.amount) / 100).toFixed(2)]);
      await connection.commit();
      return reply.code(201).send({ order: { id: orderId, business_id: request.params.businessId, restaurant_table_id: tableId, dining_tab_id: diningTabId, customer_id: customerId, customer_name: customerName || null, delivery_address: deliveryAddress, delivery_fee: deliveryFee, scheduled_for: scheduledFor, payment_method_id: paymentMethodId, discount_code: discountCode, discount_amount: discountAmount, status: "pending", subtotal, total, items } });
    } catch (error) {
      await connection.rollback();
      if (error.code === "ER_DUP_ENTRY" && idempotencyKey) {
        const [existing] = await connection.query("SELECT * FROM orders WHERE business_id = ? AND idempotency_key = ? LIMIT 1", [request.params.businessId, idempotencyKey]);
        if (existing.length) {
          if (existing[0].idempotency_hash !== requestHash) return reply.conflict("Idempotency key was already used for a different order");
          const [items] = await connection.query("SELECT id, product_id, name, unit_price, quantity, total FROM order_items WHERE order_id = ? ORDER BY created_at", [existing[0].id]);
          let savedAddress = existing[0].delivery_address;
          if (typeof savedAddress === "string") {
            try { savedAddress = JSON.parse(savedAddress); } catch { savedAddress = null; }
          }
          return reply.code(200).send({ order: {
            id: existing[0].id,
            business_id: existing[0].business_id,
            restaurant_table_id: existing[0].restaurant_table_id,
            dining_tab_id: existing[0].dining_tab_id,
            customer_id: existing[0].customer_id,
            customer_name: existing[0].customer_name,
            delivery_address: savedAddress,
            delivery_fee: Number(existing[0].delivery_fee),
            scheduled_for: existing[0].scheduled_for,
            payment_method_id: existing[0].payment_method_id,
            discount_code: existing[0].discount_code,
            discount_amount: Number(existing[0].discount_amount),
            status: existing[0].status,
            subtotal: Number(existing[0].subtotal),
            total: Number(existing[0].total),
            items: items.map((item) => ({ ...item, unit_price: Number(item.unit_price), quantity: Number(item.quantity), total: Number(item.total) })),
          } });
        }
      }
      throw error;
    } finally { connection.release(); }
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
      if (!canTransitionOrderStatus(current.status, status)) {
        await connection.rollback();
        return reply.conflict(`Order cannot transition from ${current.status} to ${status}`);
      }
      if (status === current.status) {
        const [rows] = await connection.query("SELECT * FROM orders WHERE id = ? LIMIT 1", [request.params.id]);
        await connection.commit();
        return { order: rows[0] };
      }
      if (status === "completed" && current.status !== "completed" && current.status !== "cancelled") {
        const [items] = await connection.query("SELECT product_id, quantity FROM order_items WHERE order_id = ?", [request.params.id]);
        const requirements = new Map();
        for (const item of items) {
          const [recipe] = await connection.query("SELECT inventory_item_id, quantity FROM product_ingredients WHERE product_id = ? AND business_id = ?", [item.product_id, request.params.businessId]);
          for (const ingredient of recipe) requirements.set(ingredient.inventory_item_id, (requirements.get(ingredient.inventory_item_id) || 0) + Number(ingredient.quantity) * Number(item.quantity));
        }
        for (const [inventoryItemId, required] of [...requirements].sort(([left], [right]) => left.localeCompare(right))) {
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
          const [sessions] = await connection.query("SELECT id FROM cash_register_sessions WHERE business_id = ? AND status = 'open' ORDER BY opened_at DESC LIMIT 1 FOR UPDATE", [request.params.businessId]);
          await connection.query("INSERT INTO cash_movements (id, business_id, session_id, order_id, type, amount, description) VALUES (?, ?, ?, ?, 'sale', ?, ?)", [randomUUID(), request.params.businessId, sessions[0]?.id || null, request.params.id, totalRows[0].total, "Venda concluída"]);
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
    const [[orders], [sales]] = await Promise.all([
      pool.query("SELECT COUNT(*) AS orders FROM orders WHERE business_id = ? AND created_at >= CURDATE() AND status <> 'cancelled'", [params.businessId]),
      pool.query("SELECT COALESCE(SUM(amount), 0) AS total FROM cash_movements WHERE business_id = ? AND type = 'sale' AND created_at >= CURDATE()", [params.businessId]),
    ]);
    return { orders: Number(orders[0].orders), total: Number(sales[0].total) };
  });
}
