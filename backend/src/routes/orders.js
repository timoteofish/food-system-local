import { createHash, randomUUID } from "node:crypto";
import { pool } from "../db.js";
import { requireBusinessAccess, requireRole } from "./auth.js";
import { audit } from "../audit.js";
import { canTransitionOrderStatus } from "../order-status.js";
import { discountCents, hasDecimalScale, orderLineCents, stockDemandMicroUnits, stockDemandQuantity, toMinorUnits } from "../numbers.js";
import { localDateString, localDayBoundaryUtc } from "../local-date.js";
import { hydrateOrders } from "../order-hydration.js";

const statuses = new Set(["pending", "confirmed", "preparing", "ready", "out_for_delivery", "completed", "cancelled"]);
const number = (value) => Number(Number(value).toFixed(2));
const stockUnits = (value) => toMinorUnits(value, 3);
const MAX_ORDER_AMOUNT = 99999999.99;
const MAX_ORDER_ITEMS = 100;
const MAX_PAYMENT_ALLOCATIONS = 20;
const validId = (value) => typeof value === "string" && value.length > 0 && value.length <= 36;
const validTableToken = (value) => typeof value === "string" && /^[0-9a-f]{48}$/i.test(value);
const validIdempotencyKey = (value) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

const findOrderReplay = async (connection, businessId, idempotencyKey, requestHash) => {
  const [existing] = await connection.query("SELECT * FROM orders WHERE business_id = ? AND idempotency_key = ? LIMIT 1", [businessId, idempotencyKey]);
  if (!existing.length) return null;
  const saved = existing[0];
  if (saved.idempotency_hash !== requestHash) return { conflict: true };
  const [items] = await connection.query("SELECT id, product_id, name, unit_price, quantity, total FROM order_items WHERE order_id = ? ORDER BY created_at", [saved.id]);
  let address = saved.delivery_address;
  if (typeof address === "string") {
    try { address = JSON.parse(address); } catch { address = null; }
  }
  return { order: {
    id: saved.id, business_id: saved.business_id, restaurant_table_id: saved.restaurant_table_id,
    dining_tab_id: saved.dining_tab_id, customer_id: saved.customer_id, customer_name: saved.customer_name,
    delivery_address: address, delivery_fee: Number(saved.delivery_fee), scheduled_for: saved.scheduled_for,
    payment_method_id: saved.payment_method_id, discount_code: saved.discount_code,
    discount_amount: Number(saved.discount_amount), status: saved.status, subtotal: Number(saved.subtotal),
    total: Number(saved.total),
    items: items.map((item) => ({ ...item, unit_price: Number(item.unit_price), quantity: Number(item.quantity), total: Number(item.total) })),
  } };
};

const calculateRecipeRequirements = async (connection, businessId, productQuantities) => {
  const requirements = new Map();
  for (const [productId, quantity] of productQuantities) {
    if (quantity <= 0) continue;
    const [recipe] = await connection.query("SELECT inventory_item_id, quantity FROM product_ingredients WHERE product_id = ? AND business_id = ?", [productId, businessId]);
    for (const ingredient of recipe) requirements.set(ingredient.inventory_item_id, (requirements.get(ingredient.inventory_item_id) || 0n) + stockDemandMicroUnits(ingredient.quantity, quantity));
  }
  return new Map([...requirements].map(([id, microUnits]) => [id, stockDemandQuantity(microUnits)]));
};

export const reserveOrderInventory = async (connection, businessId, orderId, userId) => {
  const [existing] = await connection.query("SELECT id FROM inventory_reservations WHERE business_id = ? AND order_id = ? AND status = 'held' LIMIT 1", [businessId, orderId]);
  if (existing.length) return existing[0].id;
  const [orderItems] = await connection.query("SELECT product_id, quantity FROM order_items WHERE order_id = ?", [orderId]);
  const productReservations = new Map();
  const remainingProducts = new Map();
  for (const row of orderItems) {
    const productId = row.product_id;
    const demand = Number(row.quantity);
    const [availableRows] = await connection.query("SELECT COALESCE(SUM(current_quantity), 0) AS quantity FROM inventory_product_lots WHERE EXISTS (SELECT 1 FROM inventory_locations loc WHERE loc.id = inventory_product_lots.location_id AND loc.business_id = inventory_product_lots.business_id AND loc.active = TRUE) AND business_id = ? AND product_id = ? AND status = 'active' AND current_quantity > 0 AND (expires_at IS NULL OR expires_at >= date('now','localtime'))", [businessId, productId]);
    const [heldRows] = await connection.query("SELECT COALESCE(SUM(pi.quantity), 0) AS quantity FROM inventory_reservation_product_items pi JOIN inventory_reservations r ON r.id = pi.reservation_id WHERE pi.business_id = ? AND pi.product_id = ? AND r.status = 'held'", [businessId, productId]);
    const alreadyReserved = productReservations.get(productId) || 0;
    const finishedQty = Math.min(stockUnits(demand), Math.max(0, stockUnits(availableRows[0].quantity) - stockUnits(heldRows[0].quantity) - stockUnits(alreadyReserved))) / 1000;
    if (finishedQty > 0) productReservations.set(productId, Number((alreadyReserved + finishedQty).toFixed(3)));
    remainingProducts.set(productId, Number(((remainingProducts.get(productId) || 0) + demand - finishedQty).toFixed(3)));
  }
  const requirements = await calculateRecipeRequirements(connection, businessId, remainingProducts);
  for (const [inventoryItemId, required] of [...requirements].sort(([left], [right]) => left.localeCompare(right))) {
    const [inventory] = await connection.query("SELECT i.id, COALESCE(SUM(l.current_quantity), 0) AS current_quantity FROM inventory_items i LEFT JOIN inventory_lots l ON l.inventory_item_id = i.id AND l.business_id = i.business_id AND EXISTS (SELECT 1 FROM inventory_locations loc WHERE loc.id = l.location_id AND loc.business_id = l.business_id AND loc.active = TRUE) AND l.status = 'active' AND (l.expires_at IS NULL OR l.expires_at >= date('now','localtime')) WHERE i.id = ? AND i.business_id = ? AND i.active = TRUE GROUP BY i.id", [inventoryItemId, businessId]);
    if (!inventory.length) throw new Error("Inventory item for this order is no longer active");
    const [reservedRows] = await connection.query("SELECT COALESCE(SUM(ri.quantity), 0) AS quantity FROM inventory_reservation_items ri JOIN inventory_reservations r ON r.id = ri.reservation_id WHERE ri.business_id = ? AND ri.inventory_item_id = ? AND r.status = 'held'", [businessId, inventoryItemId]);
    if (stockUnits(inventory[0].current_quantity) - stockUnits(reservedRows[0].quantity) < stockUnits(required)) throw new Error("Insufficient unreserved inventory to confirm this order");
  }
  const reservationId = randomUUID();
  await connection.query("INSERT INTO inventory_reservations (id, business_id, order_id, created_by) VALUES (?, ?, ?, ?)", [reservationId, businessId, orderId, userId]);
  for (const [inventoryItemId, quantity] of requirements) await connection.query("INSERT INTO inventory_reservation_items (id, business_id, reservation_id, inventory_item_id, quantity) VALUES (?, ?, ?, ?, ?)", [randomUUID(), businessId, reservationId, inventoryItemId, quantity]);
  for (const [productId, quantity] of productReservations) await connection.query("INSERT INTO inventory_reservation_product_items (id, business_id, reservation_id, product_id, quantity) VALUES (?, ?, ?, ?, ?)", [randomUUID(), businessId, reservationId, productId, quantity]);
  return reservationId;
};

const calculateUnreservedOrderConsumption = async (connection, businessId, orderId) => {
  const [orderItems] = await connection.query("SELECT product_id, quantity FROM order_items WHERE order_id = ?", [orderId]);
  const productConsumption = new Map();
  const remainingProducts = new Map();
  for (const row of orderItems) {
    const productId = row.product_id;
    const demand = Number(row.quantity);
    const [availableRows] = await connection.query("SELECT COALESCE(SUM(current_quantity), 0) AS quantity FROM inventory_product_lots WHERE EXISTS (SELECT 1 FROM inventory_locations loc WHERE loc.id = inventory_product_lots.location_id AND loc.business_id = inventory_product_lots.business_id AND loc.active = TRUE) AND business_id = ? AND product_id = ? AND status = 'active' AND current_quantity > 0 AND (expires_at IS NULL OR expires_at >= date('now','localtime'))", [businessId, productId]);
    const [heldRows] = await connection.query("SELECT COALESCE(SUM(pi.quantity), 0) AS quantity FROM inventory_reservation_product_items pi JOIN inventory_reservations r ON r.id = pi.reservation_id WHERE pi.business_id = ? AND pi.product_id = ? AND r.status = 'held'", [businessId, productId]);
    const alreadyConsumed = productConsumption.get(productId) || 0;
    const finishedQty = Math.min(stockUnits(demand), Math.max(0, stockUnits(availableRows[0].quantity) - stockUnits(heldRows[0].quantity) - stockUnits(alreadyConsumed))) / 1000;
    if (finishedQty > 0) productConsumption.set(productId, Number((alreadyConsumed + finishedQty).toFixed(3)));
    remainingProducts.set(productId, Number(((remainingProducts.get(productId) || 0) + demand - finishedQty).toFixed(3)));
  }
  return { productConsumption, ingredientRequirements: await calculateRecipeRequirements(connection, businessId, remainingProducts) };
};

const consumeFinishedProducts = async (connection, businessId, productConsumption, reservationId) => {
  for (const [productId, quantity] of [...productConsumption].sort(([a], [b]) => a.localeCompare(b))) {
    if (quantity <= 0) continue;
    const [lots] = await connection.query("SELECT id, current_quantity FROM inventory_product_lots WHERE EXISTS (SELECT 1 FROM inventory_locations loc WHERE loc.id = inventory_product_lots.location_id AND loc.business_id = inventory_product_lots.business_id AND loc.active = TRUE) AND business_id = ? AND product_id = ? AND status = 'active' AND current_quantity > 0 AND (expires_at IS NULL OR expires_at >= date('now','localtime')) ORDER BY CASE WHEN expires_at IS NULL THEN 1 ELSE 0 END, expires_at, created_at, id", [businessId, productId]);
    const [held] = await connection.query("SELECT COALESCE(SUM(pi.quantity), 0) AS quantity FROM inventory_reservation_product_items pi JOIN inventory_reservations r ON r.id = pi.reservation_id WHERE pi.business_id = ? AND pi.product_id = ? AND r.status = 'held' AND (? IS NULL OR r.id <> ?)", [businessId, productId, reservationId, reservationId]);
    if (lots.reduce((sum, lot) => sum + stockUnits(lot.current_quantity), 0) - stockUnits(held[0].quantity) < stockUnits(quantity)) throw new Error("Finished production stock no longer matches its held reservation");
    let remaining = quantity;
    for (const lot of lots) {
      if (remaining <= 0) break;
      const taken = Math.min(remaining, Number(lot.current_quantity));
      await connection.query("UPDATE inventory_product_lots SET current_quantity = ROUND(current_quantity - ?, 3), status = CASE WHEN ROUND(current_quantity - ?, 3) <= 0 THEN 'depleted' ELSE status END WHERE id = ?", [taken, taken, lot.id]);
      remaining = Number((remaining - taken).toFixed(3));
    }
  }
};

const consumeOrderInventory = async (connection, businessId, orderId, userId, requirements, reservationId) => {
  for (const [inventoryItemId, required] of [...requirements].sort(([left], [right]) => left.localeCompare(right))) {
    const [inventory] = await connection.query("SELECT current_quantity FROM inventory_items WHERE id = ? AND business_id = ? AND active = TRUE FOR UPDATE", [inventoryItemId, businessId]);
    if (!inventory.length) throw new Error("Insufficient inventory to complete order");
    const [lots] = await connection.query("SELECT id, location_id, current_quantity FROM inventory_lots WHERE EXISTS (SELECT 1 FROM inventory_locations loc WHERE loc.id = inventory_lots.location_id AND loc.business_id = inventory_lots.business_id AND loc.active = TRUE) AND business_id = ? AND inventory_item_id = ? AND status = 'active' AND current_quantity > 0 AND (expires_at IS NULL OR expires_at >= date('now','localtime')) ORDER BY CASE WHEN expires_at IS NULL THEN 1 ELSE 0 END, expires_at, received_at, id", [businessId, inventoryItemId]);
    const available = lots.reduce((sum, lot) => sum + stockUnits(lot.current_quantity), 0);
    const [held] = await connection.query("SELECT COALESCE(SUM(ri.quantity), 0) AS quantity FROM inventory_reservation_items ri JOIN inventory_reservations r ON r.id = ri.reservation_id WHERE ri.business_id = ? AND ri.inventory_item_id = ? AND r.status = 'held' AND (? IS NULL OR r.id <> ?)", [businessId, inventoryItemId, reservationId, reservationId]);
    if (available - stockUnits(held[0].quantity) < stockUnits(required)) throw new Error("Insufficient unreserved inventory to complete this order");
    const movementId = randomUUID();
    const allocations = [];
    let remaining = required;
    for (const lot of lots) {
      if (remaining <= 0) break;
      const taken = Math.min(remaining, Number(lot.current_quantity));
      await connection.query("UPDATE inventory_lots SET current_quantity = ROUND(current_quantity - ?, 3), status = CASE WHEN ROUND(current_quantity - ?, 3) <= 0 THEN 'depleted' ELSE status END WHERE id = ?", [taken, taken, lot.id]);
      allocations.push({ lot_id: lot.id, location_id: lot.location_id, quantity: taken });
      remaining = Number((remaining - taken).toFixed(3));
    }
    const [remainingRows] = await connection.query("SELECT COALESCE(SUM(current_quantity), 0) AS quantity FROM inventory_lots WHERE EXISTS (SELECT 1 FROM inventory_locations loc WHERE loc.id = inventory_lots.location_id AND loc.business_id = inventory_lots.business_id AND loc.active = TRUE) AND business_id = ? AND inventory_item_id = ? AND status = 'active' AND (expires_at IS NULL OR expires_at >= date('now','localtime'))", [businessId, inventoryItemId]);
    await connection.query("UPDATE inventory_items SET current_quantity = ? WHERE id = ? AND business_id = ?", [Number(remainingRows[0].quantity), inventoryItemId, businessId]);
    await connection.query("INSERT INTO inventory_movements (id, business_id, inventory_item_id, order_id, type, quantity, description, created_by) VALUES (?, ?, ?, ?, 'sale', ?, ?, ?)", [movementId, businessId, inventoryItemId, orderId, -required, "Automatic order stock deduction", userId]);
    for (const allocation of allocations) await connection.query("INSERT INTO inventory_movement_lot_allocations (id, business_id, movement_id, lot_id, quantity) VALUES (?, ?, ?, ?, ?)", [randomUUID(), businessId, movementId, allocation.lot_id, allocation.quantity]);
  }
};

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
    const view = request.query?.view;
    const params = [request.params.businessId];
    let where = "o.business_id = ?";
    if (view !== undefined && !["kitchen", "active", "recent"].includes(view)) throw app.httpErrors.badRequest("Invalid order view");
    if (view && status) throw app.httpErrors.badRequest("Order view cannot be combined with status");
    if (view === "kitchen") where += " AND o.status IN ('pending', 'confirmed', 'preparing', 'ready')";
    if (view === "active") where += " AND o.status IN ('pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery')";
    if (status) { if (!statuses.has(status)) throw app.httpErrors.badRequest("Invalid order status"); where += " AND o.status = ?"; params.push(status); }
    if (stationId) { where += " AND EXISTS (SELECT 1 FROM order_items soi JOIN products sop ON sop.id = soi.product_id WHERE soi.order_id = o.id AND sop.kitchen_station_id = ? AND sop.business_id = ?)"; params.push(stationId, request.params.businessId); }
    const ordering = view === "recent" ? "o.created_at DESC, o.id DESC LIMIT 3" : "COALESCE(o.scheduled_for, o.created_at) DESC";
    const [orders] = await pool.query(`SELECT o.*, t.name AS table_name FROM orders o LEFT JOIN restaurant_tables t ON t.id = o.restaurant_table_id WHERE ${where} ORDER BY ${ordering}`, params);
    return { orders: await hydrateOrders(orders, pool.query.bind(pool)) };
  });

  app.post("/api/v1/businesses/:businessId/orders", async (request, reply) => {
    const body = request.body;
    if (!isPlainObject(body)) return reply.badRequest("Order data must be an object");
    const inputItems = Array.isArray(body.items) ? body.items : [];
    if (!inputItems.length) return reply.badRequest("At least one order item is required");
    if (inputItems.length > MAX_ORDER_ITEMS || inputItems.some((item) => !item || typeof item !== "object" || Array.isArray(item))) return reply.badRequest(`Orders may contain at most ${MAX_ORDER_ITEMS} valid items`);
    if (body.payments !== undefined && !Array.isArray(body.payments)) return reply.badRequest("Payments must be an array");
    if (Array.isArray(body.payments) && (body.payments.length > MAX_PAYMENT_ALLOCATIONS || body.payments.some((payment) => !payment || typeof payment !== "object" || Array.isArray(payment)))) return reply.badRequest(`Orders may contain at most ${MAX_PAYMENT_ALLOCATIONS} valid payment allocations`);
    if (body.table_token !== undefined && body.table_token !== "" && !validTableToken(body.table_token)) return reply.badRequest("Invalid table token");
    if (body.payment_method_id !== undefined && body.payment_method_id !== null && body.payment_method_id !== "" && !validId(body.payment_method_id)) return reply.badRequest("Invalid payment method id");
    if (body.customer_id !== undefined && body.customer_id !== null && body.customer_id !== "" && !validId(body.customer_id)) return reply.badRequest("Invalid customer id");
    if (!validIdempotencyKey(body.idempotency_key)) return reply.badRequest("A valid idempotency key is required");
    const orderData = body.order === undefined || body.order === null ? {} : body.order;
    if (!isPlainObject(orderData)) return reply.badRequest("Order details must be an object");
    if (orderData.customer_name !== undefined && (typeof orderData.customer_name !== "string" || orderData.customer_name.trim().length > 160)) return reply.badRequest("Customer name must be text no longer than 160 characters");
    if (orderData.notes !== undefined && (typeof orderData.notes !== "string" || orderData.notes.length > 2000)) return reply.badRequest("Order notes must be text no longer than 2000 characters");
    const customerName = typeof orderData.customer_name === "string" ? orderData.customer_name.trim() : "";
    const orderNotes = typeof orderData.notes === "string" ? orderData.notes : "";
    let delivery = null;
    let deliveryAddress = null;
    let scheduledFor = null;
    if (body.delivery !== undefined && body.delivery !== null) {
      if (!isPlainObject(body.delivery)) return reply.badRequest("Delivery details must be an object");
      delivery = body.delivery;
      if (!isPlainObject(delivery.address)) return reply.badRequest("Delivery address must be an object");
      const addressLimits = { street: 200, number: 40, city: 120 };
      const normalizedAddress = {};
      for (const [field, maxLength] of Object.entries(addressLimits)) {
        const value = delivery.address[field];
        if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) return reply.badRequest(`Delivery address ${field} must contain 1 to ${maxLength} characters`);
        normalizedAddress[field] = value.trim();
      }
      deliveryAddress = normalizedAddress;
      const schedule = delivery.scheduled_for;
      if (schedule !== undefined && schedule !== null && schedule !== "") {
        if (typeof schedule !== "string" || schedule.length > 40) return reply.badRequest("Scheduled delivery date must be a valid date string");
        scheduledFor = new Date(schedule);
        const scheduleYear = scheduledFor.getUTCFullYear();
        if (Number.isNaN(scheduledFor.getTime()) || scheduleYear < 1000 || scheduleYear > 9999) return reply.badRequest("Scheduled delivery date is invalid");
      }
    }
    const discountInput = typeof body.discount_code === "string" ? body.discount_code.trim().toUpperCase() : "";
    if (body.discount_code !== undefined && body.discount_code !== null && body.discount_code !== "" && (typeof body.discount_code !== "string" || discountInput.length > 40)) return reply.badRequest("Discount code must be text no longer than 40 characters");
    const idempotencyKey = body.idempotency_key;
    const requestHash = createHash("sha256").update(JSON.stringify({ business_id: request.params.businessId, body })).digest("hex");
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const replay = await findOrderReplay(connection, request.params.businessId, idempotencyKey, requestHash);
      if (replay) {
        await connection.commit();
        return replay.conflict ? reply.conflict("Idempotency key was already used for a different order") : reply.code(200).send(replay);
      }
      let tableId = null;
      if (body.table_token) {
        const [tables] = await connection.query("SELECT id FROM restaurant_tables WHERE business_id = ? AND public_token = ? AND active = TRUE LIMIT 1", [request.params.businessId, body.table_token]);
        if (!tables.length) { await connection.rollback(); return reply.notFound("Table not found"); }
        tableId = tables[0].id;
      }
      let paymentMethodId = null;
      if (body.payment_method_id) {
        const [methods] = await connection.query("SELECT id FROM payment_methods WHERE id = ? AND business_id = ? AND active = TRUE LIMIT 1", [body.payment_method_id, request.params.businessId]);
        if (!methods.length) { await connection.rollback(); return reply.badRequest("Invalid payment method"); }
        paymentMethodId = methods[0].id;
      }
      const [businessRows] = await connection.query("SELECT settings FROM businesses WHERE id = ? LIMIT 1", [request.params.businessId]);
      if (!businessRows.length) { await connection.rollback(); return reply.notFound("Business not found"); }
      let businessSettings = businessRows[0].settings;
      if (typeof businessSettings === "string") {
        try { businessSettings = JSON.parse(businessSettings); } catch { businessSettings = {}; }
      }
      if (!businessSettings || typeof businessSettings !== "object" || Array.isArray(businessSettings)) businessSettings = {};
      const configuredDeliveryFee = Number(businessSettings?.delivery_fee ?? 0);
      if (!Number.isFinite(configuredDeliveryFee) || configuredDeliveryFee < 0 || configuredDeliveryFee > MAX_ORDER_AMOUNT || !hasDecimalScale(configuredDeliveryFee, 2)) {
        await connection.rollback();
        return reply.code(500).send({ error: "Business delivery fee configuration is invalid" });
      }
      const deliveryFee = deliveryAddress ? configuredDeliveryFee : 0;
      let customerId = body.customer_id || null;
      if (customerId) {
        const [customers] = await connection.query("SELECT id FROM customers WHERE id = ? AND business_id = ? LIMIT 1", [customerId, request.params.businessId]);
        if (!customers.length) { await connection.rollback(); return reply.badRequest("Customer does not belong to this business"); }
      }
      let discountCode = null;
      let discountAmount = 0;
      const ids = inputItems.map((item) => item.product_id || item.id);
      if (ids.some((id) => !validId(id))) { await connection.rollback(); return reply.badRequest("Each item must include a valid product id"); }
      const placeholders = ids.map(() => "?").join(",");
      const [products] = await connection.query(`SELECT p.id, p.name, p.price, p.active, c.name AS category_name FROM products p JOIN categories c ON c.id = p.category_id AND c.business_id = p.business_id AND c.active = TRUE WHERE p.business_id = ? AND p.id IN (${placeholders})`, [request.params.businessId, ...ids]);
      const byId = new Map(products.map((product) => [product.id, product]));
      const selectedCategories = new Set(Array.isArray(businessSettings.selected_categories)
        ? businessSettings.selected_categories.filter((name) => typeof name === "string")
        : []);
      const items = inputItems.map((item) => {
        const product = byId.get(item.product_id || item.id);
        const quantity = Number(item.quantity);
        if (!product || !product.active) throw app.httpErrors.badRequest("Product is not available on the public menu");
        if (!hasDecimalScale(item.quantity, 2) || quantity <= 0 || quantity > 999) throw app.httpErrors.badRequest("Invalid product or quantity; quantity must have at most 2 decimal places");
        if (businessSettings.show_all_products === false && !selectedCategories.has(product.category_name)) {
          throw app.httpErrors.badRequest("Product is not available on the public menu");
        }
        const total = orderLineCents(product.price, quantity) / 100;
        if (total > MAX_ORDER_AMOUNT) throw app.httpErrors.badRequest("Order item exceeds the maximum supported amount");
        return { id: randomUUID(), product_id: product.id, name: product.name, unit_price: number(product.price), quantity, total };
      });
      const subtotal = items.reduce((sum, item) => sum + toMinorUnits(item.total), 0) / 100;
      if (subtotal > MAX_ORDER_AMOUNT) { await connection.rollback(); return reply.badRequest("Order subtotal exceeds the maximum supported amount"); }
      if (discountInput) {
        discountCode = discountInput;
        const [discounts] = await connection.query("SELECT type, value FROM discounts WHERE business_id = ? AND code = ? AND active = TRUE AND (starts_at IS NULL OR starts_at <= NOW()) AND (ends_at IS NULL OR ends_at >= NOW()) LIMIT 1", [request.params.businessId, discountCode]);
        if (!discounts.length) { await connection.rollback(); return reply.badRequest("Invalid or expired discount code"); }
        discountAmount = discountCents(toMinorUnits(subtotal), discounts[0].type, discounts[0].value) / 100;
      }
      const total = (toMinorUnits(subtotal) - toMinorUnits(discountAmount) + toMinorUnits(deliveryFee)) / 100;
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
      await connection.query("INSERT INTO orders (id, business_id, idempotency_key, idempotency_hash, restaurant_table_id, customer_id, customer_name, delivery_address, delivery_fee, scheduled_for, payment_method_id, subtotal, discount_code, discount_amount, total, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [orderId, request.params.businessId, idempotencyKey, requestHash, tableId, customerId, customerName || null, deliveryAddress ? JSON.stringify(deliveryAddress) : null, deliveryFee, scheduledFor ? scheduledFor : null, paymentMethodId, subtotal, discountCode, discountAmount, total, orderNotes || null]);
      for (const item of items) await connection.query("INSERT INTO order_items (id, order_id, product_id, name, unit_price, quantity, total) VALUES (?, ?, ?, ?, ?, ?, ?)", [item.id, orderId, item.product_id, item.name, item.unit_price, item.quantity, item.total]);
      for (const payment of paymentInputs) await connection.query("INSERT INTO order_payments (id, business_id, order_id, payment_method_id, amount) VALUES (?, ?, ?, ?, ?)", [randomUUID(), request.params.businessId, orderId, payment.payment_method_id, (toMinorUnits(payment.amount) / 100).toFixed(2)]);
      if (deliveryAddress) await connection.query("INSERT INTO delivery_assignments (id, business_id, order_id, provider, status, payload) VALUES (?, ?, ?, 'local', 'requested', ?)", [randomUUID(), request.params.businessId, orderId, JSON.stringify({ source: "local" })]);
      await connection.commit();
      return reply.code(201).send({ order: { id: orderId, business_id: request.params.businessId, restaurant_table_id: tableId, dining_tab_id: null, customer_id: customerId, customer_name: customerName || null, delivery_address: deliveryAddress, delivery_fee: deliveryFee, scheduled_for: scheduledFor, payment_method_id: paymentMethodId, discount_code: discountCode, discount_amount: discountAmount, status: "pending", subtotal, total, items } });
    } catch (error) {
      await connection.rollback();
      if (error.code === "ER_DUP_ENTRY" && idempotencyKey) {
        const replay = await findOrderReplay(connection, request.params.businessId, idempotencyKey, requestHash);
        if (replay) return replay.conflict ? reply.conflict("Idempotency key was already used for a different order") : reply.code(200).send(replay);
      }
      throw error;
    } finally { connection.release(); }
  });

  app.patch("/api/v1/businesses/:businessId/orders/:id/update_status", async (request, reply) => {
    if (!(await requireBusinessAccess(request, reply))) return;
    const status = isPlainObject(request.body) && typeof request.body.status === "string" ? request.body.status : "";
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
      const actorId = request.user?.local ? null : request.user?.id || null;
      if (status === "completed") {
        const [activeDeliveries] = await connection.query("SELECT id FROM delivery_assignments WHERE business_id = ? AND order_id = ? AND status IN ('requested','assigned','picked_up') LIMIT 1", [request.params.businessId, request.params.id]);
        if (activeDeliveries.length) { await connection.rollback(); return reply.conflict("Finish the active delivery before completing the order"); }
      }
      if (["confirmed", "preparing", "ready", "out_for_delivery"].includes(status)) {
        try { await reserveOrderInventory(connection, request.params.businessId, request.params.id, actorId); }
        catch (error) { throw app.httpErrors.conflict(error.message); }
      }
      if (status === "cancelled") {
        await connection.query("UPDATE inventory_reservations SET status = 'released', updated_at = CURRENT_TIMESTAMP WHERE business_id = ? AND order_id = ? AND status = 'held'", [request.params.businessId, request.params.id]);
        const [couriers] = await connection.query("SELECT DISTINCT courier_id FROM delivery_assignments WHERE business_id = ? AND order_id = ? AND status IN ('requested','assigned','picked_up') AND courier_id IS NOT NULL", [request.params.businessId, request.params.id]);
        await connection.query("UPDATE delivery_assignments SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE business_id = ? AND order_id = ? AND status IN ('requested','assigned','picked_up')", [request.params.businessId, request.params.id]);
        for (const { courier_id: courierId } of couriers) {
          await connection.query("DELETE FROM courier_locations WHERE courier_id = ? AND business_id = ? AND NOT EXISTS (SELECT 1 FROM delivery_assignments WHERE courier_id = ? AND business_id = ? AND status IN ('assigned','picked_up'))", [courierId, request.params.businessId, courierId, request.params.businessId]);
        }
      }
      if (status === "completed" && current.status !== "completed" && current.status !== "cancelled") {
        const [reservations] = await connection.query("SELECT id FROM inventory_reservations WHERE business_id = ? AND order_id = ? AND status = 'held' LIMIT 1", [request.params.businessId, request.params.id]);
        let productConsumption;
        let requirements;
        if (reservations.length) {
          const [finishedRows] = await connection.query("SELECT product_id, quantity FROM inventory_reservation_product_items WHERE business_id = ? AND reservation_id = ?", [request.params.businessId, reservations[0].id]);
          const [ingredientRows] = await connection.query("SELECT inventory_item_id, quantity FROM inventory_reservation_items WHERE business_id = ? AND reservation_id = ?", [request.params.businessId, reservations[0].id]);
          productConsumption = new Map(finishedRows.map((row) => [row.product_id, Number(row.quantity)]));
          requirements = new Map(ingredientRows.map((row) => [row.inventory_item_id, Number(row.quantity)]));
        }
        try {
          if (!reservations.length) ({ productConsumption, ingredientRequirements: requirements } = await calculateUnreservedOrderConsumption(connection, request.params.businessId, request.params.id));
          const reservationId = reservations[0]?.id || null;
          await consumeFinishedProducts(connection, request.params.businessId, productConsumption, reservationId);
          await consumeOrderInventory(connection, request.params.businessId, request.params.id, actorId, requirements, reservationId);
        }
        catch (error) { throw app.httpErrors.conflict(error.message); }
        if (reservations.length) await connection.query("UPDATE inventory_reservations SET status = 'consumed', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [reservations[0].id]);
      }
      await connection.query("UPDATE orders SET status = ? WHERE id = ? AND business_id = ?", [status, request.params.id, request.params.businessId]);
      if (status === "completed" && current.status !== "completed" && current.status !== "cancelled") {
        const [sales] = await connection.query("SELECT id FROM cash_movements WHERE order_id = ? AND type = 'sale' LIMIT 1", [request.params.id]);
        if (!sales.length) {
          const [totalRows] = await connection.query("SELECT total FROM orders WHERE id = ? LIMIT 1", [request.params.id]);
          const [sessions] = await connection.query("SELECT id FROM cash_register_sessions WHERE business_id = ? AND status = 'open' ORDER BY opened_at DESC LIMIT 1 FOR UPDATE", [request.params.businessId]);
          await connection.query("INSERT INTO cash_movements (id, business_id, session_id, order_id, type, amount, description) VALUES (?, ?, ?, ?, 'sale', ?, ?)", [randomUUID(), request.params.businessId, sessions[0]?.id || null, request.params.id, totalRows[0].total, "Sale completed"]);
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
    const today = localDateString();
    const from = localDayBoundaryUtc(today);
    const to = localDayBoundaryUtc(today, true);
    const [[orders], [sales]] = await Promise.all([
      pool.query("SELECT COUNT(*) AS orders FROM orders WHERE business_id = ? AND created_at >= ? AND created_at < ? AND status <> 'cancelled'", [params.businessId, from, to]),
      pool.query("SELECT COALESCE(SUM(amount), 0) AS total FROM cash_movements WHERE business_id = ? AND type = 'sale' AND created_at >= ? AND created_at < ?", [params.businessId, from, to]),
    ]);
    return { orders: Number(orders[0].orders), total: Number(sales[0].total) };
  });
}
