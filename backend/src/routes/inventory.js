import { randomUUID, createHash } from "node:crypto";
import { pool } from "../db.js";
import { localDateString } from "../local-date.js";
import { requireBusinessAccess, requireRole } from "./auth.js";
import { hasDecimalScale, purchaseLineCents, reverseWeightedStockCost, stockDemandMicroUnits, stockDemandQuantity, toMinorUnits, weightedStockCost } from "../numbers.js";

const units = new Set(["unit", "g", "kg", "ml", "l"]);
const movementTypes = new Set(["adjustment", "loss"]);
const MAX_INVENTORY_QUANTITY = 999_999_999.999;
const MAX_UNIT_COST = 99_999_999.9999;
const MAX_MONEY = 9_999_999_999.99;
const MAX_MONEY_CENTS = BigInt(toMinorUnits(MAX_MONEY));
const MAX_BATCH_ITEMS = 100;
const stockUnits = (value) => toMinorUnits(value, 3);
const positiveNumber = (value) => Number.isFinite(Number(value)) && Number(value) > 0;
const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const validId = (value) => typeof value === "string" && value.length > 0 && value.length <= 36;
const validLocationId = (value) => typeof value === "string" && value.length > 0 && value.length <= 96;
const validDateOnly = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const isNotExpiredOn = (expiresAt, date = localDateString()) => !expiresAt || String(expiresAt).slice(0, 10) >= date;
const unitFamily = (unit) => ["g", "kg"].includes(unit) ? "mass" : ["ml", "l"].includes(unit) ? "volume" : unit;
const toBaseUnitFactor = (unit) => ({ g: 1, kg: 1000, ml: 1, l: 1000, unit: 1 })[unit];
const convertQuantity = (quantity, from, to) => {
  if (unitFamily(from) !== unitFamily(to)) return null;
  return Number((Number(quantity) * toBaseUnitFactor(from) / toBaseUnitFactor(to)).toFixed(3));
};
const recipeRevision = (ingredients) => createHash("sha256").update(JSON.stringify(ingredients.map((entry) => ({ inventory_item_id: entry.inventory_item_id, quantity: Number(entry.quantity) })).sort((a, b) => a.inventory_item_id.localeCompare(b.inventory_item_id)))).digest("hex");
const getIdempotencyKey = (request, reply) => {
  const key = request.headers["idempotency-key"];
  if (key === undefined) return null;
  if (typeof key !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(key)) {
    reply.badRequest("Idempotency-Key must contain 1 to 128 safe characters");
    return undefined;
  }
  return { key, requestHash: createHash("sha256").update(JSON.stringify({ method: request.method, url: request.url, body: request.body })).digest("hex") };
};
const readIdempotentResult = async (connection, businessId, idempotency, operation, reply) => {
  if (!idempotency) return null;
  const [rows] = await connection.query("SELECT operation, request_hash, response_json FROM inventory_idempotency WHERE business_id = ? AND idempotency_key = ? LIMIT 1", [businessId, idempotency.key]);
  if (!rows.length) return null;
  await connection.rollback();
  if (rows[0].operation !== operation || rows[0].request_hash !== idempotency.requestHash) reply.conflict("Idempotency key was already used for a different operation");
  else reply.code(201).send(JSON.parse(rows[0].response_json));
  return { replayed: true };
};
const saveIdempotentResult = (connection, businessId, idempotency, operation, response) => {
  if (!idempotency) return Promise.resolve();
  return connection.query("INSERT INTO inventory_idempotency (business_id, idempotency_key, operation, request_hash, response_json) VALUES (?, ?, ?, ?, ?)", [businessId, idempotency.key, operation, idempotency.requestHash, JSON.stringify(response)]);
};
const ensureMainLocation = async (connection, businessId) => {
  const [rows] = await connection.query("SELECT id FROM inventory_locations WHERE business_id = ? AND code = 'MAIN' LIMIT 1", [businessId]);
  if (rows.length) return rows[0].id;
  const id = randomUUID();
  await connection.query("INSERT INTO inventory_locations (id, business_id, name, code) VALUES (?, ?, 'Principal', 'MAIN')", [id, businessId]);
  return id;
};

export default async function inventoryRoutes(app) {
  app.get("/api/v1/businesses/:businessId/inventory/purchase-orders", async (request, reply) => {
    if (!(await requireBusinessAccess(request, reply))) return;
    const [orders] = await pool.query("SELECT po.*, s.name AS supplier_name, loc.name AS location_name FROM inventory_purchase_orders po LEFT JOIN suppliers s ON s.id = po.supplier_id JOIN inventory_locations loc ON loc.id = po.location_id WHERE po.business_id = ? ORDER BY po.created_at DESC LIMIT 100", [request.params.businessId]);
    for (const order of orders) {
      const [items] = await pool.query("SELECT oi.*, ii.name AS inventory_item_name, ii.unit FROM inventory_purchase_order_items oi JOIN inventory_items ii ON ii.id = oi.inventory_item_id WHERE oi.purchase_order_id = ?", [order.id]);
      order.items = items.map((item) => ({ ...item, ordered_quantity: Number(item.ordered_quantity), received_quantity: Number(item.received_quantity), unit_cost: Number(item.unit_cost) }));
      const [receipts] = await pool.query("SELECT r.id, r.status, r.received_at, po.total_cost FROM inventory_purchase_receipts r LEFT JOIN purchase_orders po ON po.id = r.id WHERE r.purchase_order_id = ? ORDER BY r.received_at DESC", [order.id]);
      order.receipts = receipts.map((receipt) => ({ ...receipt, total_cost: Number(receipt.total_cost || 0) }));
    }
    return { purchase_orders: orders };
  });

  app.post("/api/v1/businesses/:businessId/inventory/purchase-orders", async (request, reply) => {
    if (!(await requireRole(request, reply))) return;
    const body = request.body;
    const inputs = Array.isArray(body?.items) ? body.items : [];
    const locationId = body?.location_id;
    const supplierId = body?.supplier_id || null;
    if (!validLocationId(locationId) || !inputs.length || inputs.length > MAX_BATCH_ITEMS || inputs.some((item) => !isPlainObject(item) || !validId(item.inventory_item_id) || !positiveNumber(item.quantity) || !hasDecimalScale(item.quantity, 3) || Number(item.quantity) > MAX_INVENTORY_QUANTITY || !hasDecimalScale(item.unit_cost, 4) || Number(item.unit_cost) < 0 || Number(item.unit_cost) > MAX_UNIT_COST) || new Set(inputs.map((item) => item.inventory_item_id)).size !== inputs.length) return reply.badRequest("Purchase order location and unique item lines must have valid quantities and costs");
    if (supplierId && !validId(supplierId)) return reply.badRequest("Supplier id is invalid");
    if (body.notes !== undefined && (typeof body.notes !== "string" || body.notes.length > 255)) return reply.badRequest("Purchase order notes are invalid");
    const connection = await pool.getConnection();
    const id = randomUUID();
    try {
      await connection.beginTransaction();
      const [locations] = await connection.query("SELECT id FROM inventory_locations WHERE id = ? AND business_id = ? AND active = TRUE", [locationId, request.params.businessId]);
      if (!locations.length) { await connection.rollback(); return reply.badRequest("Receiving location does not belong to this business"); }
      if (supplierId) {
        const [suppliers] = await connection.query("SELECT id FROM suppliers WHERE id = ? AND business_id = ? AND active = TRUE", [supplierId, request.params.businessId]);
        if (!suppliers.length) { await connection.rollback(); return reply.badRequest("Supplier does not belong to this business"); }
      }
      await connection.query("INSERT INTO inventory_purchase_orders (id, business_id, supplier_id, location_id, notes, created_by) VALUES (?, ?, ?, ?, ?, ?)", [id, request.params.businessId, supplierId, locationId, body.notes || null, request.user?.local ? null : request.user?.id || null]);
      for (const item of inputs) {
        const [validItems] = await connection.query("SELECT id FROM inventory_items WHERE id = ? AND business_id = ? AND active = TRUE", [item.inventory_item_id, request.params.businessId]);
        if (!validItems.length) { await connection.rollback(); return reply.badRequest("Purchase order ingredient is unavailable"); }
        await connection.query("INSERT INTO inventory_purchase_order_items (id, business_id, purchase_order_id, inventory_item_id, ordered_quantity, unit_cost) VALUES (?, ?, ?, ?, ?, ?)", [randomUUID(), request.params.businessId, id, item.inventory_item_id, Number(item.quantity), Number(item.unit_cost)]);
      }
      await connection.commit();
      return reply.code(201).send({ purchase_order: { id, status: "ordered", location_id: locationId, supplier_id: supplierId } });
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  });

  app.patch("/api/v1/businesses/:businessId/inventory/purchase-orders/:id", async (request, reply) => {
    if (!(await requireRole(request, reply))) return;
    if (request.body?.status !== "cancelled") return reply.badRequest("Only purchase order cancellation is supported");
    const [result] = await pool.query("UPDATE inventory_purchase_orders SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND business_id = ? AND status IN ('ordered', 'partial')", [request.params.id, request.params.businessId]);
    if (!result.affectedRows) return reply.conflict("Only an open purchase order can be cancelled");
    return { purchase_order: { id: request.params.id, status: "cancelled" } };
  });

  app.post("/api/v1/businesses/:businessId/inventory/purchase-orders/:id/receipts", async (request, reply) => {
    if (!(await requireRole(request, reply))) return;
    const inputs = request.body?.items;
    if (!Array.isArray(inputs) || !inputs.length || inputs.length > MAX_BATCH_ITEMS || inputs.some((item) => !isPlainObject(item) || !validId(item.order_item_id) || !positiveNumber(item.quantity) || !hasDecimalScale(item.quantity, 3) || Number(item.quantity) > MAX_INVENTORY_QUANTITY || (item.lot_code !== undefined && (typeof item.lot_code !== "string" || item.lot_code.trim().length > 120)) || (item.expires_at != null && !validDateOnly(item.expires_at))) || new Set(inputs.map((item) => item.order_item_id)).size !== inputs.length) return reply.badRequest("Receipt lines must be unique and contain valid quantities and lot data");
    const idempotency = getIdempotencyKey(request, reply);
    if (idempotency === undefined) return;
    if (!idempotency) return reply.badRequest("Idempotency-Key is required for a purchase receipt");
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const replay = await readIdempotentResult(connection, request.params.businessId, idempotency, "purchase_receipt", reply);
      if (replay?.replayed) return;
      const [orders] = await connection.query("SELECT * FROM inventory_purchase_orders WHERE id = ? AND business_id = ? FOR UPDATE", [request.params.id, request.params.businessId]);
      if (!orders.length) { await connection.rollback(); return reply.notFound("Purchase order not found"); }
      if (["cancelled", "received"].includes(orders[0].status)) { await connection.rollback(); return reply.conflict("Purchase order is not open for receiving"); }
      const [locations] = await connection.query("SELECT id FROM inventory_locations WHERE id = ? AND business_id = ? AND active = TRUE", [orders[0].location_id, request.params.businessId]);
      if (!locations.length) { await connection.rollback(); return reply.conflict("Receiving location is inactive or unavailable"); }
      const receiptId = randomUUID();
      await connection.query("INSERT INTO inventory_purchase_receipts (id, business_id, purchase_order_id, received_by) VALUES (?, ?, ?, ?)", [receiptId, request.params.businessId, request.params.id, request.user?.local ? null : request.user?.id || null]);
      let receiptTotalCents = 0n;
      const purchaseItemRows = [];
      for (const input of inputs) {
        const [orderLines] = await connection.query("SELECT oi.*, ii.current_quantity, ii.cost_per_unit, ii.unit FROM inventory_purchase_order_items oi JOIN inventory_items ii ON ii.id = oi.inventory_item_id WHERE oi.id = ? AND oi.purchase_order_id = ? AND oi.business_id = ? FOR UPDATE", [input.order_item_id, request.params.id, request.params.businessId]);
        if (!orderLines.length) { await connection.rollback(); return reply.badRequest("Receipt line does not belong to this purchase order"); }
        const line = orderLines[0];
        const qty = Number(input.quantity);
        if (stockUnits(line.received_quantity) + stockUnits(qty) > stockUnits(line.ordered_quantity)) { await connection.rollback(); return reply.conflict("Received quantity cannot exceed the ordered amount"); }
        const lotCode = input.lot_code?.trim() || `PED-${request.params.id.slice(0, 8)}-${line.id.slice(0, 8)}`;
        const [existingLots] = await connection.query("SELECT id, expires_at, status FROM inventory_lots WHERE business_id = ? AND inventory_item_id = ? AND location_id = ? AND lot_code = ?", [request.params.businessId, line.inventory_item_id, orders[0].location_id, lotCode]);
        if (existingLots.length && (existingLots[0].expires_at || null) !== (input.expires_at || null)) { await connection.rollback(); return reply.conflict("This lot code already exists with a different expiration date at the receiving location"); }
        const receivedStatus = ["quarantined", "recalled"].includes(existingLots[0]?.status) ? existingLots[0].status : "active";
        const availableQuantity = isNotExpiredOn(input.expires_at) && receivedStatus === "active" ? qty : 0;
        const [availableRows] = await connection.query("SELECT COALESCE(SUM(current_quantity), 0) AS quantity FROM inventory_lots WHERE EXISTS (SELECT 1 FROM inventory_locations loc WHERE loc.id = inventory_lots.location_id AND loc.business_id = inventory_lots.business_id AND loc.active = TRUE) AND business_id = ? AND inventory_item_id = ? AND status = 'active' AND (expires_at IS NULL OR expires_at >= date('now','localtime'))", [request.params.businessId, line.inventory_item_id]);
        const currentAvailable = Number(availableRows[0].quantity);
        const nextQuantity = (stockUnits(currentAvailable) + stockUnits(availableQuantity)) / 1000;
        if (!Number.isFinite(nextQuantity) || nextQuantity > MAX_INVENTORY_QUANTITY) { await connection.rollback(); return reply.badRequest("Received quantity exceeds inventory limits"); }
        const weightedCost = weightedStockCost(currentAvailable, line.cost_per_unit, availableQuantity, line.unit_cost);
        await connection.query("UPDATE inventory_items SET current_quantity = ?, cost_per_unit = ? WHERE id = ? AND business_id = ?", [nextQuantity, weightedCost, line.inventory_item_id, request.params.businessId]);
        await connection.query("UPDATE inventory_purchase_order_items SET received_quantity = ROUND(received_quantity + ?, 3) WHERE id = ?", [qty, line.id]);
        const lotId = existingLots[0]?.id || randomUUID();
        if (existingLots.length) await connection.query("UPDATE inventory_lots SET initial_quantity = ROUND(initial_quantity + ?, 3), current_quantity = ROUND(current_quantity + ?, 3), status = ? WHERE id = ?", [qty, qty, receivedStatus, lotId]);
        else await connection.query("INSERT INTO inventory_lots (id, business_id, inventory_item_id, location_id, lot_code, expires_at, initial_quantity, current_quantity, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [lotId, request.params.businessId, line.inventory_item_id, orders[0].location_id, lotCode, input.expires_at || null, qty, qty, receivedStatus]);
        const movementId = randomUUID();
        await connection.query("INSERT INTO inventory_movements (id, business_id, inventory_item_id, type, quantity, description, location_id, lot_id, created_by) VALUES (?, ?, ?, 'purchase', ?, ?, ?, ?, ?)", [movementId, request.params.businessId, line.inventory_item_id, qty, `Recebimento ${receiptId}; lote ${lotCode}`, orders[0].location_id, lotId, request.user?.local ? null : request.user?.id || null]);
        await connection.query("INSERT INTO inventory_movement_lot_allocations (id, business_id, movement_id, lot_id, quantity) VALUES (?, ?, ?, ?, ?)", [randomUUID(), request.params.businessId, movementId, lotId, qty]);
        await connection.query("INSERT INTO inventory_purchase_receipt_items (id, business_id, receipt_id, order_item_id, lot_id, quantity, unit_cost) VALUES (?, ?, ?, ?, ?, ?, ?)", [randomUUID(), request.params.businessId, receiptId, line.id, lotId, qty, line.unit_cost]);
        const lineCents = purchaseLineCents(qty, line.unit_cost);
        if (lineCents > MAX_MONEY_CENTS || receiptTotalCents + lineCents > MAX_MONEY_CENTS) { await connection.rollback(); return reply.badRequest("Purchase receipt total exceeds the supported amount"); }
        receiptTotalCents += lineCents;
        const total = Number(lineCents) / 100;
        purchaseItemRows.push({ id: randomUUID(), inventory_item_id: line.inventory_item_id, quantity: qty, unit_cost: Number(line.unit_cost), total_cost: total, lot_code: lotCode, expires_at: input.expires_at || null });
      }
      const [pendingRows] = await connection.query("SELECT COUNT(*) AS lines FROM inventory_purchase_order_items WHERE purchase_order_id = ? AND received_quantity < ordered_quantity", [request.params.id]);
      const nextStatus = Number(pendingRows[0].lines) === 0 ? "received" : "partial";
      const receiptTotal = Number(receiptTotalCents) / 100;
      await connection.query("UPDATE inventory_purchase_orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [nextStatus, request.params.id]);
      await connection.query("INSERT INTO purchase_orders (id, business_id, supplier_id, total_cost, notes) VALUES (?, ?, ?, ?, ?)", [receiptId, request.params.businessId, orders[0].supplier_id, receiptTotal, `Recebimento parcial do pedido ${request.params.id}${orders[0].notes ? `, ${orders[0].notes}` : ""}`]);
      for (const item of purchaseItemRows) await connection.query("INSERT INTO purchase_items (id, purchase_order_id, inventory_item_id, quantity, unit_cost, total_cost, lot_code, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [item.id, receiptId, item.inventory_item_id, item.quantity, item.unit_cost, item.total_cost, item.lot_code, item.expires_at]);
      const response = { receipt: { id: receiptId, purchase_order_id: request.params.id, status: "received", total_cost: receiptTotal, purchase_order_status: nextStatus, items: purchaseItemRows } };
      await saveIdempotentResult(connection, request.params.businessId, idempotency, "purchase_receipt", response);
      await connection.commit();
      return reply.code(201).send(response);
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  });

  app.patch("/api/v1/businesses/:businessId/inventory/purchase-receipts/:id", async (request, reply) => {
    const user = await requireRole(request, reply);
    if (!user) return;
    if (request.body?.status !== "reversed") return reply.badRequest("Receipt status must be reversed");
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [receipts] = await connection.query("SELECT * FROM inventory_purchase_receipts WHERE id = ? AND business_id = ? FOR UPDATE", [request.params.id, request.params.businessId]);
      if (!receipts.length) { await connection.rollback(); return reply.notFound("Purchase receipt not found"); }
      const receipt = receipts[0];
      if (receipt.status !== "received") { await connection.rollback(); return reply.conflict("Only a received purchase can be reversed once"); }
      const [items] = await connection.query("SELECT ri.*, oi.purchase_order_id, oi.inventory_item_id, ii.current_quantity, ii.cost_per_unit, l.status AS lot_status, l.current_quantity AS lot_quantity, l.lot_code, l.location_id, l.expires_at, loc.active AS location_active FROM inventory_purchase_receipt_items ri JOIN inventory_purchase_order_items oi ON oi.id = ri.order_item_id JOIN inventory_items ii ON ii.id = oi.inventory_item_id JOIN inventory_lots l ON l.id = ri.lot_id JOIN inventory_locations loc ON loc.id = l.location_id AND loc.business_id = l.business_id WHERE ri.receipt_id = ?", [receipt.id]);
      for (const item of items) {
        if (stockUnits(item.lot_quantity) < stockUnits(item.quantity)) { await connection.rollback(); return reply.conflict(`Lot ${item.lot_code} has already been consumed or adjusted and cannot be fully reversed`); }
        const availableLot = Boolean(item.location_active) && item.lot_status === "active" && isNotExpiredOn(item.expires_at);
        const [currentItems] = await connection.query("SELECT current_quantity, cost_per_unit FROM inventory_items WHERE id = ? AND business_id = ? FOR UPDATE", [item.inventory_item_id, request.params.businessId]);
        if (!currentItems.length) { await connection.rollback(); return reply.conflict("Inventory item for the receipt no longer exists"); }
        if (availableLot) {
          const [heldRows] = await connection.query("SELECT COALESCE(SUM(ri.quantity), 0) AS quantity FROM inventory_reservation_items ri JOIN inventory_reservations r ON r.id = ri.reservation_id WHERE ri.business_id = ? AND ri.inventory_item_id = ? AND r.status = 'held'", [request.params.businessId, item.inventory_item_id]);
          const [availableRows] = await connection.query("SELECT COALESCE(SUM(current_quantity - CASE WHEN id = ? THEN ? ELSE 0 END), 0) AS quantity FROM inventory_lots WHERE EXISTS (SELECT 1 FROM inventory_locations loc WHERE loc.id = inventory_lots.location_id AND loc.business_id = inventory_lots.business_id AND loc.active = TRUE) AND business_id = ? AND inventory_item_id = ? AND status = 'active' AND (expires_at IS NULL OR expires_at >= date('now','localtime'))", [item.lot_id, item.quantity, request.params.businessId, item.inventory_item_id]);
          if (stockUnits(availableRows[0].quantity) < stockUnits(heldRows[0].quantity)) { await connection.rollback(); return reply.conflict("Receipt reversal would consume stock reserved for active orders"); }
        }
        await connection.query("UPDATE inventory_lots SET current_quantity = ROUND(current_quantity - ?, 3), initial_quantity = MAX(0, ROUND(initial_quantity - ?, 3)), status = CASE WHEN status = 'recalled' THEN 'recalled' WHEN ROUND(current_quantity - ?, 3) <= 0 THEN 'depleted' ELSE status END WHERE id = ?", [item.quantity, item.quantity, item.quantity, item.lot_id]);
        const [availableAfter] = await connection.query("SELECT COALESCE(SUM(current_quantity), 0) AS quantity FROM inventory_lots WHERE EXISTS (SELECT 1 FROM inventory_locations loc WHERE loc.id = inventory_lots.location_id AND loc.business_id = inventory_lots.business_id AND loc.active = TRUE) AND business_id = ? AND inventory_item_id = ? AND status = 'active' AND (expires_at IS NULL OR expires_at >= date('now','localtime'))", [request.params.businessId, item.inventory_item_id]);
        await connection.query("UPDATE inventory_items SET current_quantity = ? WHERE id = ? AND business_id = ?", [Number(availableAfter[0].quantity), item.inventory_item_id, request.params.businessId]);
        await connection.query("UPDATE inventory_purchase_order_items SET received_quantity = MAX(0, ROUND(received_quantity - ?, 3)) WHERE id = ?", [item.quantity, item.order_item_id]);
        if (availableLot) {
          const movementId = randomUUID();
          await connection.query("INSERT INTO inventory_movements (id, business_id, inventory_item_id, type, quantity, description, location_id, lot_id, created_by) VALUES (?, ?, ?, 'loss', ?, ?, ?, ?, ?)", [movementId, request.params.businessId, item.inventory_item_id, -Number(item.quantity), `Estorno do recebimento ${receipt.id}`, item.location_id, item.lot_id, user.local ? null : user.id || null]);
          await connection.query("INSERT INTO inventory_movement_lot_allocations (id, business_id, movement_id, lot_id, quantity) VALUES (?, ?, ?, ?, ?)", [randomUUID(), request.params.businessId, movementId, item.lot_id, item.quantity]);
          const nextQty = Number(availableAfter[0].quantity);
          const revisedCost = reverseWeightedStockCost(nextQty, currentItems[0].cost_per_unit, item.quantity, item.unit_cost);
          await connection.query("UPDATE inventory_items SET cost_per_unit = ? WHERE id = ? AND business_id = ?", [revisedCost, item.inventory_item_id, request.params.businessId]);
        }
      }
      await connection.query("UPDATE inventory_purchase_receipts SET status = 'reversed', reversed_by = ?, reversed_at = CURRENT_TIMESTAMP WHERE id = ?", [user.local ? null : user.id || null, receipt.id]);
      await connection.query("UPDATE purchase_orders SET status = 'cancelled', notes = notes || '; estornado' WHERE id = ?", [receipt.id]);
      const [pendingRows] = await connection.query("SELECT COUNT(*) AS lines FROM inventory_purchase_order_items WHERE purchase_order_id = ? AND received_quantity < ordered_quantity", [receipt.purchase_order_id]);
      const [orderLines] = await connection.query("SELECT COUNT(*) AS lines FROM inventory_purchase_order_items WHERE purchase_order_id = ?", [receipt.purchase_order_id]);
      const nextStatus = Number(pendingRows[0].lines) === Number(orderLines[0].lines) ? "ordered" : "partial";
      await connection.query("UPDATE inventory_purchase_orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [nextStatus, receipt.purchase_order_id]);
      await connection.query("INSERT INTO audit_logs (id, business_id, user_id, action, resource_type, resource_id, ip_address, metadata) VALUES (?, ?, ?, 'inventory_purchase_receipt.reversed', 'inventory_purchase_receipt', ?, ?, ?)", [randomUUID(), request.params.businessId, user.local ? null : user.id || null, receipt.id, request.ip || null, JSON.stringify({ purchase_order_id: receipt.purchase_order_id })]);
      await connection.commit();
      return { receipt: { id: receipt.id, status: "reversed", purchase_order_status: nextStatus } };
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  });

  app.get("/api/v1/businesses/:businessId/purchases", async (request, reply) => {
    if (!(await requireBusinessAccess(request, reply))) return;
    const query = request.query || {};
    const limit = query.limit === undefined ? 50 : Number(query.limit);
    const offset = query.offset === undefined ? 0 : Number(query.offset);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200 || !Number.isInteger(offset) || offset < 0 || offset > 1_000_000) return reply.badRequest("Purchase pagination is invalid");
    const [[purchaseRows], [countRows]] = await Promise.all([
      pool.query("SELECT po.*, s.name AS supplier_name FROM purchase_orders po LEFT JOIN suppliers s ON s.id = po.supplier_id WHERE po.business_id = ? ORDER BY po.received_at DESC, po.id DESC LIMIT ? OFFSET ?", [request.params.businessId, limit, offset]),
      pool.query("SELECT COUNT(*) AS total FROM purchase_orders WHERE business_id = ?", [request.params.businessId]),
    ]);
    const purchaseIds = purchaseRows.map((row) => row.id);
    const [lines] = purchaseIds.length
      ? await pool.query(`SELECT pi.id, pi.purchase_order_id, pi.inventory_item_id, ii.name AS inventory_item_name, ii.unit AS inventory_item_unit, pi.quantity, pi.unit_cost, pi.total_cost, pi.lot_code, pi.expires_at FROM purchase_items pi LEFT JOIN inventory_items ii ON ii.id = pi.inventory_item_id WHERE pi.purchase_order_id IN (${purchaseIds.map(() => "?").join(",")}) ORDER BY pi.id`, purchaseIds)
      : [[]];
    const purchaseMap = new Map();
    for (const row of purchaseRows) purchaseMap.set(row.id, { id: row.id, business_id: row.business_id, supplier_id: row.supplier_id, supplier_name: row.supplier_name, status: row.status, total_cost: Number(row.total_cost), notes: row.notes, received_at: row.received_at, items: [] });
    for (const row of lines) purchaseMap.get(row.purchase_order_id)?.items.push({ id: row.id, inventory_item_id: row.inventory_item_id, name: row.inventory_item_name, unit: row.inventory_item_unit, quantity: Number(row.quantity), unit_cost: Number(row.unit_cost), total_cost: Number(row.total_cost), lot_code: row.lot_code, expires_at: row.expires_at });
    const purchases = [...purchaseMap.values()];
    return { purchases, total: Number(countRows[0].total), limit, offset };
  });

  app.post("/api/v1/businesses/:businessId/purchases", async (request, reply) => {
    if (!(await requireRole(request, reply))) return;
    if (!isPlainObject(request.body)) return reply.badRequest("Purchase data must be an object");
    const inputItems = Array.isArray(request.body?.items) ? request.body.items : [];
    if (!inputItems.length || inputItems.length > MAX_BATCH_ITEMS || inputItems.some((item) => !item || typeof item !== "object" || Array.isArray(item))) return reply.badRequest(`Purchases must contain 1 to ${MAX_BATCH_ITEMS} valid items`);
    const supplierInput = request.body.supplier_id;
    if (supplierInput !== undefined && supplierInput !== null && supplierInput !== "" && !validId(supplierInput)) return reply.badRequest("Invalid supplier id");
    if (request.body.notes !== undefined && request.body.notes !== null && (typeof request.body.notes !== "string" || request.body.notes.length > 255)) return reply.badRequest("Purchase notes must be text no longer than 255 characters");
    if (request.body.location_id !== undefined && !validLocationId(request.body.location_id)) return reply.badRequest("Invalid storage location id");
    if (inputItems.some((item) => (item.lot_code !== undefined && item.lot_code !== null && (typeof item.lot_code !== "string" || item.lot_code.trim().length > 120)) || (item.expires_at !== undefined && item.expires_at !== null && !validDateOnly(item.expires_at)))) return reply.badRequest("Purchase lot or expiration data is invalid");
    if (inputItems.some((item) => !validId(item.inventory_item_id) || !positiveNumber(item.quantity) || !hasDecimalScale(item.quantity, 3) || Number(item.quantity) > MAX_INVENTORY_QUANTITY || !hasDecimalScale(item.unit_cost, 4) || Number(item.unit_cost) < 0 || Number(item.unit_cost) > MAX_UNIT_COST)) return reply.badRequest("Purchase items contain invalid ids or numeric values");
    const idempotency = getIdempotencyKey(request, reply);
    if (idempotency === undefined) return;
    const supplierId = supplierInput || null;
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const replay = await readIdempotentResult(connection, request.params.businessId, idempotency, "purchase", reply);
      if (replay?.replayed) return;
      const locationId = request.body.location_id || await ensureMainLocation(connection, request.params.businessId);
      const [locations] = await connection.query("SELECT id FROM inventory_locations WHERE id = ? AND business_id = ? AND active = TRUE LIMIT 1", [locationId, request.params.businessId]);
      if (!locations.length) { await connection.rollback(); return reply.badRequest("Storage location does not belong to this business"); }
      if (supplierId) {
        const [suppliers] = await connection.query("SELECT id FROM suppliers WHERE id = ? AND business_id = ? AND active = TRUE LIMIT 1", [supplierId, request.params.businessId]);
        if (!suppliers.length) { await connection.rollback(); return reply.badRequest("Supplier does not belong to this business"); }
      }
      const purchaseId = randomUUID();
      const normalized = [];
      const purchaseLotIds = new Map();
      let totalCostCents = 0n;
      for (const [lineIndex, input] of inputItems.entries()) {
        const quantity = Number(input.quantity);
        const unitCost = Number(input.unit_cost);
        if (!input.inventory_item_id || !positiveNumber(quantity) || !hasDecimalScale(input.quantity, 3) || quantity > MAX_INVENTORY_QUANTITY || !hasDecimalScale(input.unit_cost, 4) || unitCost < 0 || unitCost > MAX_UNIT_COST) { await connection.rollback(); return reply.badRequest("Purchase quantity must use at most 3 decimal places and unit cost at most 4"); }
        const [items] = await connection.query("SELECT id, current_quantity, cost_per_unit, unit FROM inventory_items WHERE id = ? AND business_id = ? AND active = TRUE FOR UPDATE", [input.inventory_item_id, request.params.businessId]);
        if (!items.length) { await connection.rollback(); return reply.badRequest("Inventory item not found"); }
        const item = items[0];
        const lotCode = input.lot_code?.trim() || `REC-${purchaseId.slice(0, 8)}-${lineIndex + 1}`;
        const [existingLots] = await connection.query("SELECT id, expires_at, status FROM inventory_lots WHERE business_id = ? AND inventory_item_id = ? AND location_id = ? AND lot_code = ? LIMIT 1", [request.params.businessId, item.id, locationId, lotCode]);
        if (existingLots.length && (existingLots[0].expires_at || null) !== (input.expires_at || null)) { await connection.rollback(); return reply.conflict("The same supplier lot was already registered with a different expiration date"); }
        const receivedStatus = ["quarantined", "recalled"].includes(existingLots[0]?.status) ? existingLots[0].status : "active";
        const availableQuantity = isNotExpiredOn(input.expires_at) && receivedStatus === "active" ? quantity : 0;
        const [availableRows] = await connection.query("SELECT COALESCE(SUM(current_quantity), 0) AS quantity FROM inventory_lots WHERE EXISTS (SELECT 1 FROM inventory_locations loc WHERE loc.id = inventory_lots.location_id AND loc.business_id = inventory_lots.business_id AND loc.active = TRUE) AND business_id = ? AND inventory_item_id = ? AND status = 'active' AND (expires_at IS NULL OR expires_at >= date('now','localtime'))", [request.params.businessId, item.id]);
        const currentAvailable = Number(availableRows[0].quantity);
        const nextQuantity = (stockUnits(currentAvailable) + stockUnits(availableQuantity)) / 1000;
        if (!Number.isFinite(nextQuantity) || nextQuantity > MAX_INVENTORY_QUANTITY) { await connection.rollback(); return reply.badRequest("Purchase quantity exceeds the supported inventory range"); }
        const weightedCost = weightedStockCost(currentAvailable, item.cost_per_unit, availableQuantity, unitCost);
        if (!Number.isFinite(weightedCost) || weightedCost > MAX_UNIT_COST) { await connection.rollback(); return reply.badRequest("Purchase cost exceeds the supported inventory range"); }
        await connection.query("UPDATE inventory_items SET current_quantity = ?, cost_per_unit = ? WHERE id = ? AND business_id = ?", [nextQuantity, weightedCost, item.id, request.params.businessId]);
        const lotId = existingLots[0]?.id || randomUUID();
        if (existingLots.length) await connection.query("UPDATE inventory_lots SET initial_quantity = ROUND(initial_quantity + ?, 3), current_quantity = ROUND(current_quantity + ?, 3), status = ? WHERE id = ?", [quantity, quantity, receivedStatus, lotId]);
        else await connection.query("INSERT INTO inventory_lots (id, business_id, inventory_item_id, location_id, lot_code, expires_at, initial_quantity, current_quantity, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [lotId, request.params.businessId, item.id, locationId, lotCode, input.expires_at || null, quantity, quantity, receivedStatus]);
        const lineCents = purchaseLineCents(quantity, unitCost);
        if (lineCents > MAX_MONEY_CENTS || totalCostCents + lineCents > MAX_MONEY_CENTS) { await connection.rollback(); return reply.badRequest("Purchase total exceeds the supported amount"); }
        totalCostCents += lineCents;
        const lineTotal = Number(lineCents) / 100;
        const purchaseItemId = randomUUID();
        purchaseLotIds.set(purchaseItemId, lotId);
        normalized.push({ id: purchaseItemId, inventory_item_id: item.id, quantity, unit_cost: unitCost, total_cost: lineTotal, weighted_cost: weightedCost, lot_code: lotCode, expires_at: input.expires_at || null, unit: item.unit });
      }
      const totalCost = Number(totalCostCents) / 100;
      await connection.query("INSERT INTO purchase_orders (id, business_id, supplier_id, total_cost, notes) VALUES (?, ?, ?, ?, ?)", [purchaseId, request.params.businessId, supplierId, totalCost, request.body.notes || null]);
      for (const item of normalized) {
        await connection.query("INSERT INTO purchase_items (id, purchase_order_id, inventory_item_id, quantity, unit_cost, total_cost, lot_code, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [item.id, purchaseId, item.inventory_item_id, item.quantity, item.unit_cost, item.total_cost, item.lot_code, item.expires_at]);
        const lotId = purchaseLotIds.get(item.id);
        const movementId = randomUUID();
        await connection.query("INSERT INTO inventory_movements (id, business_id, inventory_item_id, type, quantity, description, location_id, lot_id, created_by) VALUES (?, ?, ?, 'purchase', ?, ?, ?, ?, ?)", [movementId, request.params.businessId, item.inventory_item_id, item.quantity, `Compra ${purchaseId}; lote ${item.lot_code}`, locationId, lotId, request.user?.local ? null : request.user?.id || null]);
        await connection.query("INSERT INTO inventory_movement_lot_allocations (id, business_id, movement_id, lot_id, quantity) VALUES (?, ?, ?, ?, ?)", [randomUUID(), request.params.businessId, movementId, lotId, item.quantity]);
      }
      const response = { purchase: { id: purchaseId, business_id: request.params.businessId, supplier_id: supplierId, total_cost: totalCost, items: normalized } };
      await saveIdempotentResult(connection, request.params.businessId, idempotency, "purchase", response);
      await connection.commit();
      return reply.code(201).send(response);
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  });

  app.get("/api/v1/businesses/:businessId/inventory/items", async (request, reply) => {
    if (!(await requireBusinessAccess(request, reply))) return;
    const [items] = await pool.query("SELECT ii.*, COALESCE(SUM(CASE WHEN loc.active = TRUE AND lot.status = 'active' AND (lot.expires_at IS NULL OR lot.expires_at >= date('now','localtime')) THEN lot.current_quantity ELSE 0 END), 0) AS current_quantity FROM inventory_items ii LEFT JOIN inventory_lots lot ON lot.business_id = ii.business_id AND lot.inventory_item_id = ii.id LEFT JOIN inventory_locations loc ON loc.id = lot.location_id AND loc.business_id = lot.business_id WHERE ii.business_id = ? GROUP BY ii.id ORDER BY ii.name", [request.params.businessId]);
    return { items };
  });

  app.patch("/api/v1/businesses/:businessId/inventory/items/:id", async (request, reply) => {
    if (!(await requireRole(request, reply))) return;
    if (typeof request.body?.active !== "boolean") return reply.badRequest("Inventory item active must be a boolean");
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [items] = await connection.query("SELECT id, active FROM inventory_items WHERE id = ? AND business_id = ? FOR UPDATE", [request.params.id, request.params.businessId]);
      if (!items.length) { await connection.rollback(); return reply.notFound("Inventory item not found"); }
      if (!request.body.active) {
        const [heldRows] = await connection.query("SELECT COUNT(*) AS count FROM inventory_reservation_items ri JOIN inventory_reservations r ON r.id = ri.reservation_id WHERE ri.business_id = ? AND ri.inventory_item_id = ? AND r.status = 'held'", [request.params.businessId, request.params.id]);
        if (Number(heldRows[0].count) > 0) { await connection.rollback(); return reply.conflict("An ingredient used by active orders cannot be archived until those orders finish or are cancelled"); }
      }
      await connection.query("UPDATE inventory_items SET active = ? WHERE id = ? AND business_id = ?", [request.body.active ? 1 : 0, request.params.id, request.params.businessId]);
      await connection.commit();
      return { item: { id: request.params.id, active: request.body.active } };
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  });

  app.get("/api/v1/businesses/:businessId/inventory/locations", async (request, reply) => {
    if (!(await requireBusinessAccess(request, reply))) return;
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await ensureMainLocation(connection, request.params.businessId);
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    const [locations] = await pool.query("SELECT id, business_id, name, code, active, created_at FROM inventory_locations WHERE business_id = ? ORDER BY active DESC, name", [request.params.businessId]);
    return { locations };
  });

  app.post("/api/v1/businesses/:businessId/inventory/locations", async (request, reply) => {
    if (!(await requireRole(request, reply))) return;
    const body = request.body;
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const code = typeof body?.code === "string" ? body.code.trim().toUpperCase() : "";
    if (!name || name.length > 120 || !/^[A-Z0-9][A-Z0-9_-]{1,23}$/.test(code)) return reply.badRequest("Location name and code are invalid");
    const id = randomUUID();
    try {
      await pool.query("INSERT INTO inventory_locations (id, business_id, name, code) VALUES (?, ?, ?, ?)", [id, request.params.businessId, name, code]);
    } catch (error) {
      if (error.code === "ER_DUP_ENTRY") return reply.conflict("Location name or code already exists");
      throw error;
    }
    return reply.code(201).send({ location: { id, business_id: request.params.businessId, name, code, active: 1 } });
  });

  app.get("/api/v1/businesses/:businessId/inventory/balances", async (request, reply) => {
    if (!(await requireBusinessAccess(request, reply))) return;
    const locationId = request.query?.location_id;
    if (locationId !== undefined && !validLocationId(locationId)) return reply.badRequest("Location id is invalid");
    if (locationId) {
      const [locations] = await pool.query("SELECT id FROM inventory_locations WHERE id = ? AND business_id = ? AND active = TRUE LIMIT 1", [locationId, request.params.businessId]);
      if (!locations.length) return reply.notFound("Inventory location not found");
    }
    const [items] = locationId
      ? await pool.query("SELECT ii.id, ii.business_id, ii.name, ii.unit, COALESCE(cfg.minimum_quantity, ii.minimum_quantity, 0) AS minimum_quantity, ii.cost_per_unit, ii.active, COALESCE(SUM(il.current_quantity), 0) AS current_quantity, ? AS location_id FROM inventory_items ii LEFT JOIN inventory_lots il ON il.inventory_item_id = ii.id AND il.business_id = ii.business_id AND il.location_id = ? AND il.status = 'active' AND (il.expires_at IS NULL OR il.expires_at >= date('now','localtime')) LEFT JOIN inventory_location_item_settings cfg ON cfg.business_id = ii.business_id AND cfg.inventory_item_id = ii.id AND cfg.location_id = ? WHERE ii.business_id = ? GROUP BY ii.id, cfg.minimum_quantity ORDER BY ii.name", [locationId, locationId, locationId, request.params.businessId])
      : await pool.query("SELECT ii.id, ii.business_id, ii.name, ii.unit, COALESCE(ii.minimum_quantity, 0) AS minimum_quantity, ii.cost_per_unit, ii.active, COALESCE(SUM(CASE WHEN loc.active = TRUE AND il.status = 'active' AND (il.expires_at IS NULL OR il.expires_at >= date('now','localtime')) THEN il.current_quantity ELSE 0 END), 0) AS current_quantity, NULL AS location_id FROM inventory_items ii LEFT JOIN inventory_lots il ON il.inventory_item_id = ii.id AND il.business_id = ii.business_id LEFT JOIN inventory_locations loc ON loc.id = il.location_id AND loc.business_id = il.business_id WHERE ii.business_id = ? GROUP BY ii.id ORDER BY ii.name", [request.params.businessId]);
    return { items, location_id: locationId || null };
  });

  app.post("/api/v1/businesses/:businessId/inventory/stock-counts", async (request, reply) => {
    if (!(await requireRole(request, reply, ["owner", "manager", "staff"]))) return;
    const locationId = request.body?.location_id;
    if (!validLocationId(locationId)) return reply.badRequest("A storage location is required");
    const connection = await pool.getConnection();
    const countId = randomUUID();
    try {
      await connection.beginTransaction();
      const [locations] = await connection.query("SELECT id FROM inventory_locations WHERE id = ? AND business_id = ? AND active = TRUE", [locationId, request.params.businessId]);
      if (!locations.length) { await connection.rollback(); return reply.badRequest("Storage location does not belong to this business"); }
      const [items] = await connection.query("SELECT ii.id, COALESCE(SUM(il.current_quantity), 0) AS quantity FROM inventory_items ii LEFT JOIN inventory_lots il ON il.inventory_item_id = ii.id AND il.business_id = ii.business_id AND il.location_id = ? AND il.status = 'active' AND (il.expires_at IS NULL OR il.expires_at >= date('now','localtime')) WHERE ii.business_id = ? AND ii.active = TRUE GROUP BY ii.id", [locationId, request.params.businessId]);
      await connection.query("INSERT INTO stock_counts (id, business_id, location_id, created_by) VALUES (?, ?, ?, ?)", [countId, request.params.businessId, locationId, request.user?.local ? null : request.user?.id || null]);
      for (const item of items) await connection.query("INSERT INTO stock_count_items (id, business_id, stock_count_id, inventory_item_id, expected_quantity) VALUES (?, ?, ?, ?, ?)", [randomUUID(), request.params.businessId, countId, item.id, item.quantity]);
      await connection.commit();
      return reply.code(201).send({ stock_count: { id: countId, location_id: locationId, status: "draft", items: items.length } });
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  });

  app.get("/api/v1/businesses/:businessId/inventory/stock-counts/:id", async (request, reply) => {
    if (!(await requireBusinessAccess(request, reply))) return;
    const [counts] = await pool.query("SELECT sc.*, loc.name AS location_name FROM stock_counts sc JOIN inventory_locations loc ON loc.id = sc.location_id WHERE sc.id = ? AND sc.business_id = ?", [request.params.id, request.params.businessId]);
    if (!counts.length) return reply.notFound("Stock count not found");
    const [items] = await pool.query("SELECT ci.inventory_item_id, ii.name, ii.unit, ci.expected_quantity, ci.counted_quantity, ci.variance_reason FROM stock_count_items ci JOIN inventory_items ii ON ii.id = ci.inventory_item_id WHERE ci.stock_count_id = ? ORDER BY ii.name", [request.params.id]);
    return { stock_count: { ...counts[0], items: items.map((item) => ({ ...item, expected_quantity: Number(item.expected_quantity), counted_quantity: item.counted_quantity === null ? null : Number(item.counted_quantity) })) } };
  });

  app.get("/api/v1/businesses/:businessId/inventory/stock-counts", async (request, reply) => {
    if (!(await requireBusinessAccess(request, reply))) return;
    const [counts] = await pool.query("SELECT sc.id, sc.location_id, loc.name AS location_name, sc.status, sc.created_by, sc.approved_by, sc.started_at, sc.submitted_at, sc.approved_at, COUNT(ci.id) AS item_count FROM stock_counts sc JOIN inventory_locations loc ON loc.id = sc.location_id LEFT JOIN stock_count_items ci ON ci.stock_count_id = sc.id WHERE sc.business_id = ? GROUP BY sc.id ORDER BY sc.started_at DESC LIMIT 50", [request.params.businessId]);
    return { stock_counts: counts };
  });

  app.delete("/api/v1/businesses/:businessId/inventory/stock-counts/:id", async (request, reply) => {
    if (!(await requireRole(request, reply, ["owner", "manager", "staff"]))) return;
    const [result] = await pool.query("DELETE FROM stock_counts WHERE id = ? AND business_id = ? AND status = 'draft'", [request.params.id, request.params.businessId]);
    if (!result.affectedRows) return reply.conflict("Only a draft stock count can be deleted");
    return reply.code(204).send();
  });

  app.patch("/api/v1/businesses/:businessId/inventory/stock-counts/:id", async (request, reply) => {
    const status = request.body?.status;
    if (!(await requireRole(request, reply, status === "approved" ? ["owner", "manager"] : ["owner", "manager", "staff"]))) return;
    const countInputs = request.body?.items;
    if (!["submitted", "approved"].includes(status)) return reply.badRequest("Stock count status must be submitted or approved");
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [counts] = await connection.query("SELECT * FROM stock_counts WHERE id = ? AND business_id = ? FOR UPDATE", [request.params.id, request.params.businessId]);
      if (!counts.length) { await connection.rollback(); return reply.notFound("Stock count not found"); }
      const count = counts[0];
      const [locations] = await connection.query("SELECT id FROM inventory_locations WHERE id = ? AND business_id = ? AND active = TRUE", [count.location_id, request.params.businessId]);
      if (!locations.length) { await connection.rollback(); return reply.conflict("Stock count location is inactive or unavailable"); }
      if (status === "submitted") {
        if (count.status !== "draft" || !Array.isArray(countInputs)) { await connection.rollback(); return reply.conflict("Only a draft count can be submitted with counted item quantities"); }
        const [saved] = await connection.query("SELECT id, inventory_item_id FROM stock_count_items WHERE stock_count_id = ?", [count.id]);
        if (countInputs.some((item) => !isPlainObject(item) || !validId(item.inventory_item_id) || !Number.isFinite(Number(item.counted_quantity)) || Number(item.counted_quantity) < 0 || !hasDecimalScale(item.counted_quantity, 3) || Number(item.counted_quantity) > MAX_INVENTORY_QUANTITY)) { await connection.rollback(); return reply.badRequest("Counted quantities must include every item with valid nonnegative quantities"); }
        const byItem = new Map(countInputs.map((item) => [item.inventory_item_id, item]));
        if (byItem.size !== saved.length || saved.some((item) => !byItem.has(item.inventory_item_id))) { await connection.rollback(); return reply.badRequest("Counted quantities must include every item exactly once"); }
        for (const row of saved) { const input = byItem.get(row.inventory_item_id); await connection.query("UPDATE stock_count_items SET counted_quantity = ?, variance_reason = ? WHERE id = ?", [Number(input.counted_quantity), typeof input.reason === "string" ? input.reason.slice(0, 255) : null, row.id]); }
        await connection.query("UPDATE stock_counts SET status = 'submitted', submitted_at = CURRENT_TIMESTAMP WHERE id = ?", [count.id]);
      } else {
        if (count.status !== "submitted") { await connection.rollback(); return reply.conflict("Only a submitted count can be approved"); }
        if (count.created_by && count.created_by === request.user?.id) { await connection.rollback(); return reply.conflict("A different authorized team member must approve this stock count"); }
        const [rows] = await connection.query("SELECT ci.*, ii.name FROM stock_count_items ci JOIN inventory_items ii ON ii.id = ci.inventory_item_id WHERE ci.stock_count_id = ?", [count.id]);
        for (const row of rows) {
          const [locationBalances] = await connection.query("SELECT COALESCE(SUM(current_quantity), 0) AS quantity FROM inventory_lots WHERE business_id = ? AND inventory_item_id = ? AND location_id = ? AND status = 'active' AND (expires_at IS NULL OR expires_at >= date('now','localtime'))", [request.params.businessId, row.inventory_item_id, count.location_id]);
          if (Math.abs(Number(locationBalances[0].quantity) - Number(row.expected_quantity)) >= 0.0005) { await connection.rollback(); return reply.conflict("Inventory changed at this location during the count. Discard it and start a new count."); }
          const variance = (stockUnits(row.counted_quantity) - stockUnits(row.expected_quantity)) / 1000;
          if (Math.abs(variance) < 0.0005) continue;
          const [items] = await connection.query("SELECT current_quantity FROM inventory_items WHERE id = ? AND business_id = ? FOR UPDATE", [row.inventory_item_id, request.params.businessId]);
          if (!items.length) continue;
          if (variance < 0) {
            const [held] = await connection.query("SELECT COALESCE(SUM(ri.quantity), 0) AS quantity FROM inventory_reservation_items ri JOIN inventory_reservations r ON r.id = ri.reservation_id WHERE ri.business_id = ? AND ri.inventory_item_id = ? AND r.status = 'held'", [request.params.businessId, row.inventory_item_id]);
            const [available] = await connection.query("SELECT COALESCE(SUM(current_quantity), 0) AS quantity FROM inventory_lots WHERE EXISTS (SELECT 1 FROM inventory_locations loc WHERE loc.id = inventory_lots.location_id AND loc.business_id = inventory_lots.business_id AND loc.active = TRUE) AND business_id = ? AND inventory_item_id = ? AND status = 'active' AND (expires_at IS NULL OR expires_at >= date('now','localtime'))", [request.params.businessId, row.inventory_item_id]);
            if (stockUnits(available[0].quantity) + stockUnits(variance) < stockUnits(held[0].quantity)) { await connection.rollback(); return reply.conflict(`Count variance would consume inventory reserved for orders: ${row.name}`); }
          }
          const movementId = randomUUID();
          await connection.query("INSERT INTO inventory_movements (id, business_id, inventory_item_id, type, quantity, description, location_id, created_by) VALUES (?, ?, ?, 'adjustment', ?, ?, ?, ?)", [movementId, request.params.businessId, row.inventory_item_id, variance, `Ajuste aprovado na contagem ${count.id}${row.variance_reason ? `: ${row.variance_reason}` : ""}`, count.location_id, request.user?.local ? null : request.user?.id || null]);
          let lotId = null;
          if (variance > 0) {
            lotId = randomUUID();
            await connection.query("INSERT INTO inventory_lots (id, business_id, inventory_item_id, location_id, lot_code, initial_quantity, current_quantity) VALUES (?, ?, ?, ?, ?, ?, ?)", [lotId, request.params.businessId, row.inventory_item_id, count.location_id, `CONTAGEM-${count.id.slice(0, 8)}-${row.inventory_item_id.slice(0, 8)}`, variance, variance]);
            await connection.query("UPDATE inventory_movements SET lot_id = ? WHERE id = ?", [lotId, movementId]);
          } else {
            let remaining = -variance;
            const [lots] = await connection.query("SELECT id, current_quantity FROM inventory_lots WHERE business_id = ? AND inventory_item_id = ? AND location_id = ? AND status = 'active' AND current_quantity > 0 AND (expires_at IS NULL OR expires_at >= date('now','localtime')) ORDER BY CASE WHEN expires_at IS NULL THEN 1 ELSE 0 END, expires_at, received_at, id", [request.params.businessId, row.inventory_item_id, count.location_id]);
            if (lots.reduce((sum, lot) => sum + stockUnits(lot.current_quantity), 0) < stockUnits(remaining)) { await connection.rollback(); return reply.conflict(`Lot balance does not reconcile for ${row.name}`); }
            for (const lot of lots) {
              if (remaining <= 0) break;
              const taken = Math.min(remaining, Number(lot.current_quantity));
              await connection.query("UPDATE inventory_lots SET current_quantity = ROUND(current_quantity - ?, 3), status = CASE WHEN ROUND(current_quantity - ?, 3) <= 0 THEN 'depleted' ELSE status END WHERE id = ?", [taken, taken, lot.id]);
              await connection.query("INSERT INTO inventory_movement_lot_allocations (id, business_id, movement_id, lot_id, quantity) VALUES (?, ?, ?, ?, ?)", [randomUUID(), request.params.businessId, movementId, lot.id, taken]);
              remaining = Number((remaining - taken).toFixed(3));
            }
          }
          const [availableRows] = await connection.query("SELECT COALESCE(SUM(current_quantity), 0) AS quantity FROM inventory_lots WHERE EXISTS (SELECT 1 FROM inventory_locations loc WHERE loc.id = inventory_lots.location_id AND loc.business_id = inventory_lots.business_id AND loc.active = TRUE) AND business_id = ? AND inventory_item_id = ? AND status = 'active' AND (expires_at IS NULL OR expires_at >= date('now','localtime'))", [request.params.businessId, row.inventory_item_id]);
          await connection.query("UPDATE inventory_items SET current_quantity = ? WHERE id = ? AND business_id = ?", [Number(availableRows[0].quantity), row.inventory_item_id, request.params.businessId]);
          if (lotId) await connection.query("INSERT INTO inventory_movement_lot_allocations (id, business_id, movement_id, lot_id, quantity) VALUES (?, ?, ?, ?, ?)", [randomUUID(), request.params.businessId, movementId, lotId, variance]);
        }
        await connection.query("UPDATE stock_counts SET status = 'approved', approved_at = CURRENT_TIMESTAMP, approved_by = ? WHERE id = ?", [request.user?.local ? null : request.user?.id || null, count.id]);
      }
      await connection.commit();
      return { stock_count: { id: count.id, status } };
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  });

  app.get("/api/v1/businesses/:businessId/inventory/reorder", async (request, reply) => {
    if (!(await requireBusinessAccess(request, reply))) return;
    const locationId = request.query?.location_id;
    if (locationId !== undefined && !validLocationId(locationId)) return reply.badRequest("Location id is invalid");
    const clauses = ["ii.business_id = ?", "ii.active = TRUE", "loc.active = TRUE"];
    const params = [request.params.businessId];
    if (locationId) { clauses.push("loc.id = ?"); params.push(locationId); }
    const [items] = await pool.query(`SELECT ii.id AS inventory_item_id, ii.name, ii.unit, loc.id AS location_id, loc.name AS location_name, COALESCE(SUM(lot.current_quantity), 0) AS current_quantity, COALESCE(cfg.minimum_quantity, ii.minimum_quantity, 0) AS minimum_quantity, COALESCE(cfg.reorder_quantity, 0) AS reorder_quantity, COALESCE(cfg.lead_time_days, 0) AS lead_time_days FROM inventory_items ii CROSS JOIN inventory_locations loc LEFT JOIN inventory_lots lot ON lot.inventory_item_id = ii.id AND lot.business_id = ii.business_id AND lot.location_id = loc.id AND lot.status = 'active' AND (lot.expires_at IS NULL OR lot.expires_at >= date('now','localtime')) LEFT JOIN inventory_location_item_settings cfg ON cfg.business_id = ii.business_id AND cfg.inventory_item_id = ii.id AND cfg.location_id = loc.id WHERE ${clauses.join(" AND ")} GROUP BY ii.id, loc.id ORDER BY loc.name, ii.name`, params);
    const reorder = items.map((item) => ({ ...item, current_quantity: Number(item.current_quantity), minimum_quantity: Number(item.minimum_quantity), reorder_quantity: Number(item.reorder_quantity), lead_time_days: Number(item.lead_time_days) })).filter((item) => item.current_quantity <= item.minimum_quantity);
    return { items: reorder };
  });

  app.put("/api/v1/businesses/:businessId/inventory/reorder-settings", async (request, reply) => {
    if (!(await requireRole(request, reply))) return;
    const entries = request.body?.items;
    if (!Array.isArray(entries) || !entries.length || entries.length > MAX_BATCH_ITEMS) return reply.badRequest(`Provide 1 to ${MAX_BATCH_ITEMS} reorder settings`);
    if (entries.some((entry) => !isPlainObject(entry) || !validId(entry.inventory_item_id) || !validLocationId(entry.location_id) || ![entry.minimum_quantity, entry.reorder_quantity].every((value) => Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= MAX_INVENTORY_QUANTITY && hasDecimalScale(value, 3)) || !Number.isInteger(Number(entry.lead_time_days)) || Number(entry.lead_time_days) < 0 || Number(entry.lead_time_days) > 365)) return reply.badRequest("Reorder thresholds or lead times are invalid");
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      for (const entry of entries) {
        const [[itemRows], [locationRows]] = await Promise.all([
          connection.query("SELECT id FROM inventory_items WHERE id = ? AND business_id = ? AND active = TRUE", [entry.inventory_item_id, request.params.businessId]),
          connection.query("SELECT id FROM inventory_locations WHERE id = ? AND business_id = ? AND active = TRUE", [entry.location_id, request.params.businessId]),
        ]);
        if (!itemRows.length || !locationRows.length) { await connection.rollback(); return reply.badRequest("Each reorder setting must reference an active item and location in this business"); }
        await connection.query("INSERT INTO inventory_location_item_settings (business_id, location_id, inventory_item_id, minimum_quantity, reorder_quantity, lead_time_days) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(location_id, inventory_item_id) DO UPDATE SET minimum_quantity = excluded.minimum_quantity, reorder_quantity = excluded.reorder_quantity, lead_time_days = excluded.lead_time_days", [request.params.businessId, entry.location_id, entry.inventory_item_id, Number(entry.minimum_quantity), Number(entry.reorder_quantity), Number(entry.lead_time_days)]);
      }
      await connection.commit();
      return { saved: entries.length };
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  });

  app.get("/api/v1/businesses/:businessId/inventory/transfers", async (request, reply) => {
    if (!(await requireBusinessAccess(request, reply))) return;
    const [transfers] = await pool.query("SELECT t.*, src.name AS from_location_name, dst.name AS to_location_name FROM inventory_transfer_orders t JOIN inventory_locations src ON src.id = t.from_location_id JOIN inventory_locations dst ON dst.id = t.to_location_id WHERE t.business_id = ? ORDER BY t.created_at DESC LIMIT 100", [request.params.businessId]);
    for (const transfer of transfers) {
      const [lines] = await pool.query("SELECT ti.inventory_item_id, ii.name, ii.unit, ti.lot_id, l.lot_code, l.expires_at, ti.quantity FROM inventory_transfer_items ti JOIN inventory_items ii ON ii.id = ti.inventory_item_id JOIN inventory_lots l ON l.id = ti.lot_id WHERE ti.transfer_id = ?", [transfer.id]);
      transfer.items = lines.map((line) => ({ ...line, quantity: Number(line.quantity) }));
    }
    return { transfers };
  });

  app.post("/api/v1/businesses/:businessId/inventory/transfers", async (request, reply) => {
    if (!(await requireRole(request, reply))) return;
    const { from_location_id: fromId, to_location_id: toId, items: inputs, notes } = request.body || {};
    if (!validLocationId(fromId) || !validLocationId(toId) || fromId === toId || !Array.isArray(inputs) || !inputs.length || inputs.length > MAX_BATCH_ITEMS || (notes !== undefined && (typeof notes !== "string" || notes.length > 255))) return reply.badRequest("Transfer locations, items, or notes are invalid");
    if (inputs.some((item) => !isPlainObject(item) || !validId(item.inventory_item_id) || !positiveNumber(item.quantity) || !hasDecimalScale(item.quantity, 3) || Number(item.quantity) > MAX_INVENTORY_QUANTITY) || new Set(inputs.map((item) => item.inventory_item_id)).size !== inputs.length) return reply.badRequest("Transfer item quantities must be valid, with each ingredient listed once");
    const transferId = randomUUID();
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [locations] = await connection.query("SELECT id FROM inventory_locations WHERE business_id = ? AND active = TRUE AND id IN (?, ?)", [request.params.businessId, fromId, toId]);
      if (locations.length !== 2) { await connection.rollback(); return reply.badRequest("Both transfer locations must be active and belong to this business"); }
      await connection.query("INSERT INTO inventory_transfer_orders (id, business_id, from_location_id, to_location_id, notes, created_by) VALUES (?, ?, ?, ?, ?, ?)", [transferId, request.params.businessId, fromId, toId, notes || null, request.user?.local ? null : request.user?.id || null]);
      for (const input of inputs) {
        const [lots] = await connection.query("SELECT id, current_quantity FROM inventory_lots WHERE business_id = ? AND inventory_item_id = ? AND location_id = ? AND status = 'active' AND current_quantity > 0 AND (expires_at IS NULL OR expires_at >= date('now','localtime')) ORDER BY CASE WHEN expires_at IS NULL THEN 1 ELSE 0 END, expires_at, received_at, id", [request.params.businessId, input.inventory_item_id, fromId]);
        let remaining = Number(input.quantity);
        for (const lot of lots) {
          if (remaining <= 0) break;
          const quantity = Math.min(remaining, Number(lot.current_quantity));
          await connection.query("INSERT INTO inventory_transfer_items (id, business_id, transfer_id, inventory_item_id, lot_id, quantity) VALUES (?, ?, ?, ?, ?, ?)", [randomUUID(), request.params.businessId, transferId, input.inventory_item_id, lot.id, quantity]);
          remaining = Number((remaining - quantity).toFixed(3));
        }
        if (remaining > 0) { await connection.rollback(); return reply.conflict("Insufficient stock at the source location"); }
      }
      await connection.commit();
      return reply.code(201).send({ transfer: { id: transferId, status: "draft", from_location_id: fromId, to_location_id: toId } });
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  });

  app.patch("/api/v1/businesses/:businessId/inventory/transfers/:id", async (request, reply) => {
    if (!(await requireRole(request, reply))) return;
    const status = request.body?.status;
    if (!new Set(["in_transit", "received", "cancelled"]).has(status)) return reply.badRequest("Transfer status is invalid");
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [transfers] = await connection.query("SELECT * FROM inventory_transfer_orders WHERE id = ? AND business_id = ? FOR UPDATE", [request.params.id, request.params.businessId]);
      if (!transfers.length) { await connection.rollback(); return reply.notFound("Transfer not found"); }
      const transfer = transfers[0];
      const allowed = transfer.status === "draft" && ["in_transit", "cancelled"].includes(status) || transfer.status === "in_transit" && status === "received";
      if (!allowed) { await connection.rollback(); return reply.conflict(`Transfer cannot transition from ${transfer.status} to ${status}`); }
      if (status !== "cancelled") {
        const [locations] = await connection.query("SELECT id FROM inventory_locations WHERE business_id = ? AND active = TRUE AND id IN (?, ?)", [request.params.businessId, transfer.from_location_id, transfer.to_location_id]);
        if (status === "in_transit" && locations.length !== 2 || status === "received" && !locations.some((location) => location.id === transfer.to_location_id)) { await connection.rollback(); return reply.conflict("Transfer location is inactive or unavailable"); }
      }
      const [lines] = await connection.query("SELECT ti.*, l.lot_code, l.expires_at, l.current_quantity, l.status AS lot_status FROM inventory_transfer_items ti JOIN inventory_lots l ON l.id = ti.lot_id AND l.business_id = ti.business_id WHERE ti.transfer_id = ? AND ti.business_id = ? ORDER BY l.expires_at, l.received_at, l.id", [transfer.id, request.params.businessId]);
      if (status === "in_transit") {
        for (const line of lines) {
          if (line.lot_status !== "active") { await connection.rollback(); return reply.conflict("Only active lots can be shipped in a stock transfer"); }
          if (!isNotExpiredOn(line.expires_at)) { await connection.rollback(); return reply.conflict("Expired lots cannot be shipped in a stock transfer"); }
          if (stockUnits(line.current_quantity) < stockUnits(line.quantity)) { await connection.rollback(); return reply.conflict("Source lot stock changed after this transfer was drafted"); }
          const [itemRows] = await connection.query("SELECT id FROM inventory_items WHERE id = ? AND business_id = ? FOR UPDATE", [line.inventory_item_id, request.params.businessId]);
          const [availableRows] = await connection.query("SELECT COALESCE(SUM(current_quantity), 0) AS quantity FROM inventory_lots WHERE EXISTS (SELECT 1 FROM inventory_locations loc WHERE loc.id = inventory_lots.location_id AND loc.business_id = inventory_lots.business_id AND loc.active = TRUE) AND business_id = ? AND inventory_item_id = ? AND status = 'active' AND (expires_at IS NULL OR expires_at >= date('now','localtime'))", [request.params.businessId, line.inventory_item_id]);
          const [held] = await connection.query("SELECT COALESCE(SUM(ri.quantity), 0) AS quantity FROM inventory_reservation_items ri JOIN inventory_reservations r ON r.id = ri.reservation_id WHERE ri.business_id = ? AND ri.inventory_item_id = ? AND r.status = 'held'", [request.params.businessId, line.inventory_item_id]);
          if (!itemRows.length || stockUnits(availableRows[0].quantity) - stockUnits(line.quantity) < stockUnits(held[0].quantity)) { await connection.rollback(); return reply.conflict("Transfer would consume stock reserved for active orders"); }
          await connection.query("UPDATE inventory_lots SET current_quantity = ROUND(current_quantity - ?, 3), status = CASE WHEN ROUND(current_quantity - ?, 3) <= 0 THEN 'depleted' ELSE status END WHERE id = ?", [line.quantity, line.quantity, line.lot_id]);
          const [remainingRows] = await connection.query("SELECT COALESCE(SUM(current_quantity), 0) AS quantity FROM inventory_lots WHERE EXISTS (SELECT 1 FROM inventory_locations loc WHERE loc.id = inventory_lots.location_id AND loc.business_id = inventory_lots.business_id AND loc.active = TRUE) AND business_id = ? AND inventory_item_id = ? AND status = 'active' AND (expires_at IS NULL OR expires_at >= date('now','localtime'))", [request.params.businessId, line.inventory_item_id]);
          await connection.query("UPDATE inventory_items SET current_quantity = ? WHERE id = ? AND business_id = ?", [Number(remainingRows[0].quantity), line.inventory_item_id, request.params.businessId]);
          const movementId = randomUUID();
          await connection.query("INSERT INTO inventory_movements (id, business_id, inventory_item_id, type, quantity, description, location_id, lot_id, created_by) VALUES (?, ?, ?, 'adjustment', ?, ?, ?, ?, ?)", [movementId, request.params.businessId, line.inventory_item_id, -line.quantity, `Transferência ${transfer.id} enviada`, transfer.from_location_id, line.lot_id, request.user?.local ? null : request.user?.id || null]);
          await connection.query("INSERT INTO inventory_movement_lot_allocations (id, business_id, movement_id, lot_id, quantity) VALUES (?, ?, ?, ?, ?)", [randomUUID(), request.params.businessId, movementId, line.lot_id, line.quantity]);
        }
        await connection.query("UPDATE inventory_transfer_orders SET status = 'in_transit', shipped_at = CURRENT_TIMESTAMP, approved_by = ? WHERE id = ?", [request.user?.local ? null : request.user?.id || null, transfer.id]);
      } else if (status === "received") {
        for (const line of lines) {
          const [existing] = await connection.query("SELECT id, expires_at, status, current_quantity FROM inventory_lots WHERE business_id = ? AND inventory_item_id = ? AND location_id = ? AND lot_code = ?", [request.params.businessId, line.inventory_item_id, transfer.to_location_id, line.lot_code]);
          const lotId = existing[0]?.id || randomUUID();
          if (existing.length && (existing[0].expires_at || null) !== (line.expires_at || null)) { await connection.rollback(); return reply.conflict("Destination already has this lot code with a different expiration date"); }
          const receivedStatus = ["quarantined", "recalled"].includes(line.lot_status) ? line.lot_status : "active";
          const destinationStatus = existing[0]?.status === "recalled" || receivedStatus === "recalled" ? "recalled"
            : existing[0]?.status === "quarantined" || receivedStatus === "quarantined" ? "quarantined"
              : "active";
          const lotIsUnexpired = isNotExpiredOn(line.expires_at);
          const previousAvailable = existing[0]?.status === "active" && lotIsUnexpired ? Number(existing[0].current_quantity) : 0;
          const nextAvailable = destinationStatus === "active" && lotIsUnexpired ? previousAvailable + Number(line.quantity) : 0;
          if (existing.length) await connection.query("UPDATE inventory_lots SET initial_quantity = ROUND(initial_quantity + ?, 3), current_quantity = ROUND(current_quantity + ?, 3), status = ? WHERE id = ?", [line.quantity, line.quantity, destinationStatus, lotId]);
          else await connection.query("INSERT INTO inventory_lots (id, business_id, inventory_item_id, location_id, lot_code, expires_at, initial_quantity, current_quantity, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [lotId, request.params.businessId, line.inventory_item_id, transfer.to_location_id, line.lot_code, line.expires_at, line.quantity, line.quantity, destinationStatus]);
          const availableDelta = Number((nextAvailable - previousAvailable).toFixed(3));
          const [availableRows] = await connection.query("SELECT COALESCE(SUM(current_quantity), 0) AS quantity FROM inventory_lots WHERE EXISTS (SELECT 1 FROM inventory_locations loc WHERE loc.id = inventory_lots.location_id AND loc.business_id = inventory_lots.business_id AND loc.active = TRUE) AND business_id = ? AND inventory_item_id = ? AND status = 'active' AND (expires_at IS NULL OR expires_at >= date('now','localtime'))", [request.params.businessId, line.inventory_item_id]);
          await connection.query("UPDATE inventory_items SET current_quantity = ? WHERE id = ? AND business_id = ?", [Number(availableRows[0].quantity), line.inventory_item_id, request.params.businessId]);
          const movementId = randomUUID();
          await connection.query("INSERT INTO inventory_movements (id, business_id, inventory_item_id, type, quantity, description, location_id, lot_id, created_by) VALUES (?, ?, ?, 'adjustment', ?, ?, ?, ?, ?)", [movementId, request.params.businessId, line.inventory_item_id, line.quantity, `Transferência ${transfer.id} recebida`, transfer.to_location_id, lotId, request.user?.local ? null : request.user?.id || null]);
          await connection.query("INSERT INTO inventory_movement_lot_allocations (id, business_id, movement_id, lot_id, quantity) VALUES (?, ?, ?, ?, ?)", [randomUUID(), request.params.businessId, movementId, lotId, line.quantity]);
        }
        await connection.query("UPDATE inventory_transfer_orders SET status = 'received', received_at = CURRENT_TIMESTAMP WHERE id = ?", [transfer.id]);
      } else await connection.query("UPDATE inventory_transfer_orders SET status = 'cancelled' WHERE id = ?", [transfer.id]);
      await connection.commit();
      return { transfer: { id: transfer.id, status } };
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  });

  app.get("/api/v1/businesses/:businessId/inventory/lots", async (request, reply) => {
    if (!(await requireBusinessAccess(request, reply))) return;
    const [lots] = await pool.query("SELECT l.*, ii.name AS inventory_item_name, ii.unit, loc.name AS location_name, CASE WHEN l.expires_at IS NOT NULL AND l.expires_at < date('now','localtime') THEN 1 ELSE 0 END AS is_expired FROM inventory_lots l JOIN inventory_items ii ON ii.id = l.inventory_item_id AND ii.business_id = l.business_id JOIN inventory_locations loc ON loc.id = l.location_id WHERE l.business_id = ? ORDER BY CASE WHEN l.expires_at IS NULL THEN 1 ELSE 0 END, l.expires_at, l.received_at DESC LIMIT 500", [request.params.businessId]);
    return { lots: lots.map((lot) => ({ ...lot, initial_quantity: Number(lot.initial_quantity), current_quantity: Number(lot.current_quantity) })) };
  });

  app.patch("/api/v1/businesses/:businessId/inventory/lots/:id", async (request, reply) => {
    const user = await requireRole(request, reply);
    if (!user) return;
    const nextStatus = request.body?.status;
    if (!new Set(["active", "quarantined", "recalled"]).has(nextStatus)) return reply.badRequest("Lot status is invalid");
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [lots] = await connection.query("SELECT * FROM inventory_lots WHERE id = ? AND business_id = ? FOR UPDATE", [request.params.id, request.params.businessId]);
      if (!lots.length) { await connection.rollback(); return reply.notFound("Inventory lot not found"); }
      const lot = lots[0];
      const previous = lot.status;
      const allowed = previous === nextStatus || previous === "active" && ["quarantined", "recalled"].includes(nextStatus) || previous === "quarantined" && ["active", "recalled"].includes(nextStatus);
      if (!allowed || previous === "recalled" && nextStatus !== "recalled") { await connection.rollback(); return reply.conflict(`Lot cannot transition from ${previous} to ${nextStatus}`); }
      if (previous !== nextStatus) {
        const quantity = Number(lot.current_quantity);
        const isUnexpired = isNotExpiredOn(lot.expires_at);
        const [locations] = await connection.query("SELECT active FROM inventory_locations WHERE id = ? AND business_id = ?", [lot.location_id, request.params.businessId]);
        const activeLocation = Boolean(locations[0]?.active);
        const wasAvailable = activeLocation && previous === "active" && isUnexpired;
        const becomesAvailable = activeLocation && nextStatus === "active" && isUnexpired;
        const delta = wasAvailable && !becomesAvailable ? -quantity : !wasAvailable && becomesAvailable ? quantity : 0;
        if (delta < 0) {
          await connection.query("SELECT id FROM inventory_items WHERE id = ? AND business_id = ? FOR UPDATE", [lot.inventory_item_id, request.params.businessId]);
          const [availableRows] = await connection.query("SELECT COALESCE(SUM(current_quantity), 0) AS quantity FROM inventory_lots WHERE EXISTS (SELECT 1 FROM inventory_locations loc WHERE loc.id = inventory_lots.location_id AND loc.business_id = inventory_lots.business_id AND loc.active = TRUE) AND business_id = ? AND inventory_item_id = ? AND status = 'active' AND (expires_at IS NULL OR expires_at >= date('now','localtime'))", [request.params.businessId, lot.inventory_item_id]);
          const [heldRows] = await connection.query("SELECT COALESCE(SUM(ri.quantity), 0) AS quantity FROM inventory_reservation_items ri JOIN inventory_reservations r ON r.id = ri.reservation_id WHERE ri.business_id = ? AND ri.inventory_item_id = ? AND r.status = 'held'", [request.params.businessId, lot.inventory_item_id]);
          if (stockUnits(availableRows[0].quantity) + stockUnits(delta) < stockUnits(heldRows[0].quantity)) { await connection.rollback(); return reply.conflict("This lot contains inventory reserved for active orders"); }
        }
        await connection.query("UPDATE inventory_lots SET status = ? WHERE id = ?", [nextStatus, lot.id]);
        const [availableAfter] = await connection.query("SELECT COALESCE(SUM(current_quantity), 0) AS quantity FROM inventory_lots WHERE EXISTS (SELECT 1 FROM inventory_locations loc WHERE loc.id = inventory_lots.location_id AND loc.business_id = inventory_lots.business_id AND loc.active = TRUE) AND business_id = ? AND inventory_item_id = ? AND status = 'active' AND (expires_at IS NULL OR expires_at >= date('now','localtime'))", [request.params.businessId, lot.inventory_item_id]);
        await connection.query("UPDATE inventory_items SET current_quantity = ? WHERE id = ? AND business_id = ?", [Number(availableAfter[0].quantity), lot.inventory_item_id, request.params.businessId]);
        if (delta !== 0) {
          const movementId = randomUUID();
          const type = nextStatus === "recalled" ? "loss" : "adjustment";
          await connection.query("INSERT INTO inventory_movements (id, business_id, inventory_item_id, type, quantity, description, location_id, lot_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [movementId, request.params.businessId, lot.inventory_item_id, type, delta, `Lote ${lot.lot_code}: ${previous} → ${nextStatus}`, lot.location_id, lot.id, user.local ? null : user.id || null]);
          await connection.query("INSERT INTO inventory_movement_lot_allocations (id, business_id, movement_id, lot_id, quantity) VALUES (?, ?, ?, ?, ?)", [randomUUID(), request.params.businessId, movementId, lot.id, quantity]);
        }
        await connection.query("INSERT INTO audit_logs (id, business_id, user_id, action, resource_type, resource_id, ip_address, metadata) VALUES (?, ?, ?, ?, 'inventory_lot', ?, ?, ?)", [randomUUID(), request.params.businessId, user.local ? null : user.id || null, `inventory_lot.${nextStatus}`, lot.id, request.ip || null, JSON.stringify({ lot_code: lot.lot_code, previous_status: previous, status: nextStatus, quantity })]);
      }
      await connection.commit();
      return { lot: { id: lot.id, status: nextStatus, current_quantity: Number(lot.current_quantity) } };
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  });

  app.get("/api/v1/businesses/:businessId/inventory/production-orders", async (request, reply) => {
    if (!(await requireBusinessAccess(request, reply))) return;
    const [orders] = await pool.query("SELECT po.*, p.name AS product_name, loc.name AS location_name, rv.version AS recipe_version, pl.id AS stock_lot_id, pl.status AS stock_lot_status, COALESCE(pl.current_quantity, 0) AS stock_quantity, CASE WHEN loc.active = TRUE AND pl.status = 'active' AND (pl.expires_at IS NULL OR pl.expires_at >= date('now','localtime')) THEN COALESCE(pl.current_quantity, 0) ELSE 0 END AS available_quantity, CASE WHEN pl.expires_at IS NOT NULL AND pl.expires_at < date('now','localtime') THEN 1 ELSE 0 END AS is_expired FROM production_orders po JOIN products p ON p.id = po.product_id LEFT JOIN inventory_locations loc ON loc.id = po.location_id LEFT JOIN product_recipe_versions rv ON rv.id = po.recipe_version_id LEFT JOIN inventory_product_lots pl ON pl.production_order_id = po.id WHERE po.business_id = ? ORDER BY po.created_at DESC LIMIT 100", [request.params.businessId]);
    return { production_orders: orders.map((order) => ({ ...order, planned_quantity: Number(order.planned_quantity), actual_quantity: order.actual_quantity === null ? null : Number(order.actual_quantity), waste_quantity: Number(order.waste_quantity || 0), yield_percent: Number(order.yield_percent ?? 100), stock_quantity: Number(order.stock_quantity), available_quantity: Number(order.available_quantity) })) };
  });

  app.post("/api/v1/businesses/:businessId/inventory/production-orders", async (request, reply) => {
    if (!(await requireRole(request, reply))) return;
    const { product_id: productId, location_id: locationId, batch_code: batchCode, planned_quantity: plannedInput, expires_at: expiresAt } = request.body || {};
    const plannedQuantity = Number(plannedInput);
    if (!validId(productId) || !validLocationId(locationId) || typeof batchCode !== "string" || !batchCode.trim() || batchCode.trim().length > 100 || !positiveNumber(plannedQuantity) || !hasDecimalScale(plannedInput, 3) || plannedQuantity > MAX_INVENTORY_QUANTITY || (expiresAt != null && !validDateOnly(expiresAt))) return reply.badRequest("Production product, batch, location, quantity, or expiration is invalid");
    const [products] = await pool.query("SELECT id FROM products WHERE id = ? AND business_id = ?", [productId, request.params.businessId]);
    const [locations] = await pool.query("SELECT id FROM inventory_locations WHERE id = ? AND business_id = ? AND active = TRUE", [locationId, request.params.businessId]);
    const [versions] = await pool.query("SELECT id FROM product_recipe_versions WHERE product_id = ? AND business_id = ? ORDER BY version DESC LIMIT 1", [productId, request.params.businessId]);
    if (!products.length || !locations.length) return reply.badRequest("Production product and location must belong to this business");
    if (!versions.length) return reply.conflict("Save a versioned recipe for this product before production");
    const id = randomUUID();
    try {
      await pool.query("INSERT INTO production_orders (id, business_id, product_id, recipe_version_id, batch_code, planned_quantity, location_id, expires_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [id, request.params.businessId, productId, versions[0].id, batchCode.trim(), plannedQuantity, locationId, expiresAt || null, request.user?.local ? null : request.user?.id || null]);
    } catch (error) {
      if (error.code === "ER_DUP_ENTRY") return reply.conflict("Production batch code already exists");
      throw error;
    }
    return reply.code(201).send({ production_order: { id, business_id: request.params.businessId, product_id: productId, location_id: locationId, batch_code: batchCode.trim(), planned_quantity: plannedQuantity, status: "planned", recipe_version_id: versions[0].id } });
  });

  app.patch("/api/v1/businesses/:businessId/inventory/production-orders/:id", async (request, reply) => {
    if (!(await requireRole(request, reply))) return;
    const status = request.body?.status;
    if (!new Set(["in_progress", "completed", "cancelled"]).has(status)) return reply.badRequest("Production status is invalid");
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query("SELECT * FROM production_orders WHERE id = ? AND business_id = ? FOR UPDATE", [request.params.id, request.params.businessId]);
      if (!rows.length) { await connection.rollback(); return reply.notFound("Production order not found"); }
      const order = rows[0];
      const allowed = order.status === "planned" && ["in_progress", "cancelled"].includes(status) || order.status === "in_progress" && ["completed", "cancelled"].includes(status);
      if (!allowed) { await connection.rollback(); return reply.conflict(`Production order cannot transition from ${order.status} to ${status}`); }
      if (status !== "cancelled") {
        const [locations] = await connection.query("SELECT id FROM inventory_locations WHERE id = ? AND business_id = ? AND active = TRUE", [order.location_id, request.params.businessId]);
        if (!locations.length) { await connection.rollback(); return reply.conflict("Production location is inactive or unavailable"); }
      }
      if (status === "in_progress") await connection.query("UPDATE production_orders SET status = 'in_progress', started_at = CURRENT_TIMESTAMP WHERE id = ?", [order.id]);
      else if (status === "cancelled") await connection.query("UPDATE production_orders SET status = 'cancelled' WHERE id = ?", [order.id]);
      else {
        const actual = Number(request.body.actual_quantity);
        if (!positiveNumber(actual) || !hasDecimalScale(request.body.actual_quantity, 3) || actual > Number(order.planned_quantity)) { await connection.rollback(); return reply.badRequest("Actual production must be positive and cannot exceed planned quantity"); }
        const [versions] = await connection.query("SELECT recipe_json FROM product_recipe_versions WHERE id = ? AND business_id = ?", [order.recipe_version_id, request.params.businessId]);
        if (!versions.length) { await connection.rollback(); return reply.conflict("The production recipe version is unavailable"); }
        const ingredients = JSON.parse(versions[0].recipe_json);
        const requirements = new Map();
        try {
          for (const ingredient of ingredients) requirements.set(ingredient.inventory_item_id, stockDemandQuantity(stockDemandMicroUnits(ingredient.quantity, order.planned_quantity)));
        } catch (error) { await connection.rollback(); return reply.conflict(error.message); }
        for (const [itemId, required] of [...requirements].sort(([a], [b]) => a.localeCompare(b))) {
          const [itemRows] = await connection.query("SELECT id FROM inventory_items WHERE id = ? AND business_id = ? AND active = TRUE FOR UPDATE", [itemId, request.params.businessId]);
          const [held] = await connection.query("SELECT COALESCE(SUM(ri.quantity), 0) AS quantity FROM inventory_reservation_items ri JOIN inventory_reservations r ON r.id = ri.reservation_id WHERE ri.business_id = ? AND ri.inventory_item_id = ? AND r.status = 'held'", [request.params.businessId, itemId]);
          if (!itemRows.length) { await connection.rollback(); return reply.conflict("Production ingredient is unavailable"); }
          const [businessAvailable] = await connection.query("SELECT COALESCE(SUM(current_quantity), 0) AS quantity FROM inventory_lots WHERE EXISTS (SELECT 1 FROM inventory_locations loc WHERE loc.id = inventory_lots.location_id AND loc.business_id = inventory_lots.business_id AND loc.active = TRUE) AND business_id = ? AND inventory_item_id = ? AND status = 'active' AND (expires_at IS NULL OR expires_at >= date('now','localtime'))", [request.params.businessId, itemId]);
          const [lots] = await connection.query("SELECT id, current_quantity FROM inventory_lots WHERE business_id = ? AND inventory_item_id = ? AND location_id = ? AND status = 'active' AND current_quantity > 0 AND (expires_at IS NULL OR expires_at >= date('now','localtime')) ORDER BY CASE WHEN expires_at IS NULL THEN 1 ELSE 0 END, expires_at, received_at, id", [request.params.businessId, itemId, order.location_id]);
          if (stockUnits(businessAvailable[0].quantity) - stockUnits(required) < stockUnits(held[0].quantity)) { await connection.rollback(); return reply.conflict("Production would consume stock reserved for active orders"); }
          if (lots.reduce((sum, lot) => sum + stockUnits(lot.current_quantity), 0) < stockUnits(required)) { await connection.rollback(); return reply.conflict("Not enough unexpired ingredients at the production location"); }
          const movementId = randomUUID();
          await connection.query("INSERT INTO inventory_movements (id, business_id, inventory_item_id, type, quantity, description, location_id, created_by) VALUES (?, ?, ?, 'sale', ?, ?, ?, ?)", [movementId, request.params.businessId, itemId, -required, `Production ${order.batch_code}`, order.location_id, request.user?.local ? null : request.user?.id || null]);
          let remaining = required;
          for (const lot of lots) {
            if (remaining <= 0) break;
            const used = Math.min(remaining, Number(lot.current_quantity));
            await connection.query("UPDATE inventory_lots SET current_quantity = ROUND(current_quantity - ?, 3), status = CASE WHEN ROUND(current_quantity - ?, 3) <= 0 THEN 'depleted' ELSE status END WHERE id = ?", [used, used, lot.id]);
            await connection.query("INSERT INTO inventory_movement_lot_allocations (id, business_id, movement_id, lot_id, quantity) VALUES (?, ?, ?, ?, ?)", [randomUUID(), request.params.businessId, movementId, lot.id, used]);
            remaining = Number((remaining - used).toFixed(3));
          }
          const [remainingRows] = await connection.query("SELECT COALESCE(SUM(current_quantity), 0) AS quantity FROM inventory_lots WHERE EXISTS (SELECT 1 FROM inventory_locations loc WHERE loc.id = inventory_lots.location_id AND loc.business_id = inventory_lots.business_id AND loc.active = TRUE) AND business_id = ? AND inventory_item_id = ? AND status = 'active' AND (expires_at IS NULL OR expires_at >= date('now','localtime'))", [request.params.businessId, itemId]);
          await connection.query("UPDATE inventory_items SET current_quantity = ? WHERE id = ? AND business_id = ?", [Number(remainingRows[0].quantity), itemId, request.params.businessId]);
        }
        const waste = Number((Number(order.planned_quantity) - actual).toFixed(3));
        const yieldPercent = Number((actual / Number(order.planned_quantity) * 100).toFixed(2));
        await connection.query("UPDATE production_orders SET status = 'completed', actual_quantity = ?, waste_quantity = ?, yield_percent = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?", [actual, waste, yieldPercent, order.id]);
        await connection.query("INSERT INTO inventory_product_lots (id, business_id, product_id, location_id, production_order_id, batch_code, expires_at, produced_quantity, current_quantity) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [randomUUID(), request.params.businessId, order.product_id, order.location_id, order.id, order.batch_code, order.expires_at, actual, actual]);
      }
      await connection.commit();
      return { production_order: { id: order.id, status, actual_quantity: request.body.actual_quantity ?? null } };
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  });

  app.patch("/api/v1/businesses/:businessId/inventory/product-lots/:id", async (request, reply) => {
    const user = await requireRole(request, reply);
    if (!user) return;
    const status = request.body?.status;
    if (!new Set(["active", "quarantined", "recalled"]).has(status)) return reply.badRequest("Finished product lot status is invalid");
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [lots] = await connection.query("SELECT * FROM inventory_product_lots WHERE id = ? AND business_id = ? FOR UPDATE", [request.params.id, request.params.businessId]);
      if (!lots.length) { await connection.rollback(); return reply.notFound("Finished product lot not found"); }
      const lot = lots[0];
      const allowed = lot.status === status || lot.status === "active" && ["quarantined", "recalled"].includes(status) || lot.status === "quarantined" && ["active", "recalled"].includes(status);
      if (!allowed || lot.status === "recalled" && status !== "recalled") { await connection.rollback(); return reply.conflict(`Finished product lot cannot transition from ${lot.status} to ${status}`); }
      if (lot.status !== status) {
        const [held] = await connection.query("SELECT COALESCE(SUM(pi.quantity), 0) AS quantity FROM inventory_reservation_product_items pi JOIN inventory_reservations r ON r.id = pi.reservation_id WHERE pi.business_id = ? AND pi.product_id = ? AND r.status = 'held'", [request.params.businessId, lot.product_id]);
        if (lot.status === "active" && status !== "active") {
          const [availableAfter] = await connection.query("SELECT COALESCE(SUM(current_quantity - CASE WHEN id = ? THEN current_quantity ELSE 0 END), 0) AS quantity FROM inventory_product_lots WHERE EXISTS (SELECT 1 FROM inventory_locations loc WHERE loc.id = inventory_product_lots.location_id AND loc.business_id = inventory_product_lots.business_id AND loc.active = TRUE) AND business_id = ? AND product_id = ? AND status = 'active' AND (expires_at IS NULL OR expires_at >= date('now','localtime'))", [lot.id, request.params.businessId, lot.product_id]);
          if (stockUnits(availableAfter[0].quantity) < stockUnits(held[0].quantity)) { await connection.rollback(); return reply.conflict("Finished product stock is reserved by active orders"); }
        }
        await connection.query("UPDATE inventory_product_lots SET status = ? WHERE id = ?", [status, lot.id]);
        await connection.query("INSERT INTO audit_logs (id, business_id, user_id, action, resource_type, resource_id, ip_address, metadata) VALUES (?, ?, ?, ?, 'inventory_product_lot', ?, ?, ?)", [randomUUID(), request.params.businessId, user.local ? null : user.id || null, `inventory_product_lot.${status}`, lot.id, request.ip || null, JSON.stringify({ batch_code: lot.batch_code, previous_status: lot.status, status, current_quantity: Number(lot.current_quantity) })]);
      }
      await connection.commit();
      return { lot: { id: lot.id, status, current_quantity: Number(lot.current_quantity) } };
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  });

  app.get("/api/v1/businesses/:businessId/inventory/movements", async (request, reply) => {
    if (!(await requireBusinessAccess(request, reply))) return;
    const query = request.query || {};
    const limit = query.limit === undefined ? 50 : Number(query.limit);
    const offset = query.offset === undefined ? 0 : Number(query.offset);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200 || !Number.isInteger(offset) || offset < 0 || offset > 1_000_000) return reply.badRequest("Movement pagination is invalid");
    const clauses = ["m.business_id = ?"];
    const values = [request.params.businessId];
    if (query.item_id !== undefined) {
      if (!validId(query.item_id)) return reply.badRequest("Inventory item id is invalid");
      clauses.push("m.inventory_item_id = ?");
      values.push(query.item_id);
    }
    if (query.type !== undefined) {
      if (!new Set(["purchase", "adjustment", "loss", "sale"]).has(query.type)) return reply.badRequest("Movement type is invalid");
      clauses.push("m.type = ?");
      values.push(query.type);
    }
    const where = clauses.join(" AND ");
    const [[countRows], [movements]] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS total FROM inventory_movements m WHERE ${where}`, values),
      pool.query(`SELECT m.*, ii.name AS inventory_item_name, ii.unit AS inventory_item_unit, loc.name AS location_name, lot.lot_code FROM inventory_movements m JOIN inventory_items ii ON ii.id = m.inventory_item_id AND ii.business_id = m.business_id LEFT JOIN inventory_locations loc ON loc.id = m.location_id LEFT JOIN inventory_lots lot ON lot.id = m.lot_id WHERE ${where} ORDER BY m.created_at DESC, m.id DESC LIMIT ? OFFSET ?`, [...values, limit, offset]),
    ]);
    return { movements, total: Number(countRows[0].total), limit, offset };
  });

  app.post("/api/v1/businesses/:businessId/inventory/items", async (request, reply) => {
    if (!(await requireRole(request, reply))) return;
    const body = request.body;
    if (!isPlainObject(body) || typeof body.name !== "string" || (body.unit !== undefined && typeof body.unit !== "string")) return reply.badRequest("Inventory item name and unit must be text");
    const name = body.name.trim();
    const unit = body.unit === undefined ? "unit" : body.unit;
    const quantityInput = body.current_quantity === undefined ? 0 : body.current_quantity;
    const minimumInput = body.minimum_quantity === undefined ? 0 : body.minimum_quantity;
    const costInput = body.cost_per_unit === undefined ? 0 : body.cost_per_unit;
    const currentQuantity = Number(quantityInput);
    const minimumQuantity = Number(minimumInput);
    const costPerUnit = Number(costInput);
    if (!name || name.length > 160 || !units.has(unit) || ![currentQuantity, minimumQuantity, costPerUnit].every(Number.isFinite) || !hasDecimalScale(quantityInput, 3) || !hasDecimalScale(minimumInput, 3) || !hasDecimalScale(costInput, 4) || currentQuantity < 0 || currentQuantity > MAX_INVENTORY_QUANTITY || minimumQuantity < 0 || minimumQuantity > MAX_INVENTORY_QUANTITY || costPerUnit < 0 || costPerUnit > MAX_UNIT_COST) return reply.badRequest("Inventory quantities support at most 3 decimal places and unit cost at most 4");
    const id = randomUUID();
    const connection = await pool.getConnection();
    let locationId;
    try {
      await connection.beginTransaction();
      locationId = body.location_id === undefined ? await ensureMainLocation(connection, request.params.businessId) : body.location_id;
      if (!validLocationId(locationId)) { await connection.rollback(); return reply.badRequest("Storage location id is invalid"); }
      const [locations] = await connection.query("SELECT id FROM inventory_locations WHERE id = ? AND business_id = ? AND active = TRUE LIMIT 1", [locationId, request.params.businessId]);
      if (!locations.length) { await connection.rollback(); return reply.badRequest("Storage location does not belong to this business"); }
      await connection.query("INSERT INTO inventory_items (id, business_id, name, unit, current_quantity, minimum_quantity, cost_per_unit) VALUES (?, ?, ?, ?, ?, ?, ?)", [id, request.params.businessId, name, unit, currentQuantity, minimumQuantity, costPerUnit]);
      if (currentQuantity > 0) {
        const lotId = randomUUID();
        const movementId = randomUUID();
        await connection.query("INSERT INTO inventory_lots (id, business_id, inventory_item_id, location_id, lot_code, initial_quantity, current_quantity) VALUES (?, ?, ?, ?, ?, ?, ?)", [lotId, request.params.businessId, id, locationId, `ABERTURA-${id}`, currentQuantity, currentQuantity]);
        await connection.query("INSERT INTO inventory_movements (id, business_id, inventory_item_id, type, quantity, description, location_id, lot_id, created_by) VALUES (?, ?, ?, 'adjustment', ?, ?, ?, ?, ?)", [movementId, request.params.businessId, id, currentQuantity, "Saldo inicial do cadastro", locationId, lotId, request.user?.local ? null : request.user?.id || null]);
        await connection.query("INSERT INTO inventory_movement_lot_allocations (id, business_id, movement_id, lot_id, quantity) VALUES (?, ?, ?, ?, ?)", [randomUUID(), request.params.businessId, movementId, lotId, currentQuantity]);
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      if (error.code === "ER_DUP_ENTRY") return reply.conflict("Inventory item already exists");
      throw error;
    } finally { connection.release(); }
    return reply.code(201).send({ item: { id, business_id: request.params.businessId, name, unit, location_id: locationId } });
  });

  app.post("/api/v1/businesses/:businessId/inventory/items/:id/movements", async (request, reply) => {
    if (!(await requireRole(request, reply))) return;
    const body = request.body;
    if (!isPlainObject(body) || typeof body.type !== "string" || (body.description !== undefined && body.description !== null && (typeof body.description !== "string" || body.description.length > 255)) || (body.direction !== undefined && body.direction !== 1 && body.direction !== -1)) return reply.badRequest("Invalid movement data");
    const type = body.type;
    const quantity = Number(body.quantity);
    if (!movementTypes.has(type) || !positiveNumber(quantity) || !hasDecimalScale(body.quantity, 3) || quantity > MAX_INVENTORY_QUANTITY) return reply.badRequest("Inventory movement quantity must have at most 3 decimal places");
    const idempotency = getIdempotencyKey(request, reply);
    if (idempotency === undefined) return;
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const replay = await readIdempotentResult(connection, request.params.businessId, idempotency, "movement", reply);
      if (replay?.replayed) return;
      const [items] = await connection.query("SELECT id, current_quantity FROM inventory_items WHERE id = ? AND business_id = ? AND active = TRUE FOR UPDATE", [request.params.id, request.params.businessId]);
      if (!items.length) {
        await connection.rollback();
        return reply.notFound("Inventory item not found");
      }
      const locationId = body.location_id || await ensureMainLocation(connection, request.params.businessId);
      if (!validLocationId(locationId)) { await connection.rollback(); return reply.badRequest("Storage location id is invalid"); }
      const [locations] = await connection.query("SELECT id FROM inventory_locations WHERE id = ? AND business_id = ? AND active = TRUE LIMIT 1", [locationId, request.params.businessId]);
      if (!locations.length) { await connection.rollback(); return reply.badRequest("Storage location does not belong to this business"); }
      const delta = type === "loss" ? -quantity : Number(body.direction) === -1 ? -quantity : quantity;
      const [availableBefore] = await connection.query("SELECT COALESCE(SUM(current_quantity), 0) AS quantity FROM inventory_lots WHERE EXISTS (SELECT 1 FROM inventory_locations loc WHERE loc.id = inventory_lots.location_id AND loc.business_id = inventory_lots.business_id AND loc.active = TRUE) AND business_id = ? AND inventory_item_id = ? AND status = 'active' AND (expires_at IS NULL OR expires_at >= date('now','localtime'))", [request.params.businessId, request.params.id]);
      const nextQuantity = (stockUnits(availableBefore[0].quantity) + stockUnits(delta)) / 1000;
      if (nextQuantity < 0) { await connection.rollback(); return reply.conflict("Insufficient inventory"); }
      if (delta < 0) {
        const [heldRows] = await connection.query("SELECT COALESCE(SUM(ri.quantity), 0) AS quantity FROM inventory_reservation_items ri JOIN inventory_reservations r ON r.id = ri.reservation_id WHERE ri.business_id = ? AND ri.inventory_item_id = ? AND r.status = 'held'", [request.params.businessId, request.params.id]);
        if (stockUnits(nextQuantity) < stockUnits(heldRows[0].quantity)) { await connection.rollback(); return reply.conflict("This adjustment would consume stock reserved for active orders"); }
      }
      if (!Number.isFinite(nextQuantity) || nextQuantity > MAX_INVENTORY_QUANTITY) { await connection.rollback(); return reply.badRequest("Inventory quantity exceeds the supported range"); }
      const movementId = randomUUID();
      let targetLotId = null;
      const lotAllocations = [];
      if (delta > 0) {
        targetLotId = randomUUID();
        await connection.query("INSERT INTO inventory_lots (id, business_id, inventory_item_id, location_id, lot_code, initial_quantity, current_quantity) VALUES (?, ?, ?, ?, ?, ?, ?)", [targetLotId, request.params.businessId, request.params.id, locationId, `AJUSTE-${movementId}`, delta, delta]);
      } else {
        const [lots] = await connection.query("SELECT id, current_quantity FROM inventory_lots WHERE business_id = ? AND inventory_item_id = ? AND location_id = ? AND status = 'active' AND current_quantity > 0 AND (expires_at IS NULL OR expires_at >= date('now','localtime')) ORDER BY CASE WHEN expires_at IS NULL THEN 1 ELSE 0 END, expires_at, received_at, id", [request.params.businessId, request.params.id, locationId]);
        const available = lots.reduce((sum, lot) => sum + stockUnits(lot.current_quantity), 0);
        if (available < stockUnits(-delta)) { await connection.rollback(); return reply.conflict("Insufficient inventory at the selected location"); }
        let remaining = -delta;
        for (const lot of lots) {
          if (remaining <= 0) break;
          const taken = Math.min(remaining, Number(lot.current_quantity));
          await connection.query("UPDATE inventory_lots SET current_quantity = ROUND(current_quantity - ?, 3), status = CASE WHEN ROUND(current_quantity - ?, 3) <= 0 THEN 'depleted' ELSE status END WHERE id = ?", [taken, taken, lot.id]);
          lotAllocations.push({ lotId: lot.id, quantity: taken });
          remaining = Number((remaining - taken).toFixed(3));
        }
      }
      const [availableAfter] = await connection.query("SELECT COALESCE(SUM(current_quantity), 0) AS quantity FROM inventory_lots WHERE EXISTS (SELECT 1 FROM inventory_locations loc WHERE loc.id = inventory_lots.location_id AND loc.business_id = inventory_lots.business_id AND loc.active = TRUE) AND business_id = ? AND inventory_item_id = ? AND status = 'active' AND (expires_at IS NULL OR expires_at >= date('now','localtime'))", [request.params.businessId, request.params.id]);
      await connection.query("UPDATE inventory_items SET current_quantity = ? WHERE id = ? AND business_id = ?", [Number(availableAfter[0].quantity), request.params.id, request.params.businessId]);
      await connection.query("INSERT INTO inventory_movements (id, business_id, inventory_item_id, type, quantity, description, location_id, lot_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [movementId, request.params.businessId, request.params.id, type, delta, body.description || null, locationId, targetLotId, request.user?.local ? null : request.user?.id || null]);
      if (targetLotId) lotAllocations.push({ lotId: targetLotId, quantity: delta });
      for (const allocation of lotAllocations) await connection.query("INSERT INTO inventory_movement_lot_allocations (id, business_id, movement_id, lot_id, quantity) VALUES (?, ?, ?, ?, ?)", [randomUUID(), request.params.businessId, movementId, allocation.lotId, allocation.quantity]);
      const response = { movement: { id: movementId, item_id: request.params.id, type, quantity: delta } };
      await saveIdempotentResult(connection, request.params.businessId, idempotency, "movement", response);
      await connection.commit();
      return reply.code(201).send(response);
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  });

  app.get("/api/v1/businesses/:businessId/products/:productId/recipe", async (request, reply) => {
    if (!(await requireBusinessAccess(request, reply))) return;
    const [products] = await pool.query("SELECT id FROM products WHERE id = ? AND business_id = ? LIMIT 1", [request.params.productId, request.params.businessId]);
    if (!products.length) return reply.notFound("Product not found");
    const [ingredients] = await pool.query("SELECT pi.inventory_item_id, pi.quantity, ii.name, ii.unit FROM product_ingredients pi JOIN inventory_items ii ON ii.id = pi.inventory_item_id AND ii.business_id = pi.business_id WHERE pi.product_id = ? AND pi.business_id = ? ORDER BY pi.inventory_item_id", [request.params.productId, request.params.businessId]);
    return { ingredients, revision: recipeRevision(ingredients) };
  });

  app.get("/api/v1/businesses/:businessId/products/:productId/recipe/versions", async (request, reply) => {
    if (!(await requireBusinessAccess(request, reply))) return;
    const [versions] = await pool.query("SELECT id, version, created_by, created_at FROM product_recipe_versions WHERE product_id = ? AND business_id = ? ORDER BY version DESC LIMIT 100", [request.params.productId, request.params.businessId]);
    return { versions };
  });

  app.put("/api/v1/businesses/:businessId/products/:productId/recipe", async (request, reply) => {
    if (!(await requireRole(request, reply))) return;
    const ingredients = Array.isArray(request.body?.ingredients) ? request.body.ingredients : [];
    if (!ingredients.length || ingredients.length > MAX_BATCH_ITEMS || ingredients.some((entry) => !entry || typeof entry !== "object" || Array.isArray(entry))) return reply.badRequest(`Recipes must contain 1 to ${MAX_BATCH_ITEMS} valid ingredients`);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [products] = await connection.query("SELECT id FROM products WHERE id = ? AND business_id = ? LIMIT 1", [request.params.productId, request.params.businessId]);
      if (!products.length) { await connection.rollback(); return reply.notFound("Product not found"); }
      if (request.body?.expected_revision !== undefined && typeof request.body.expected_revision !== "string") { await connection.rollback(); return reply.badRequest("Recipe revision is invalid"); }
      const [currentIngredients] = await connection.query("SELECT inventory_item_id, quantity FROM product_ingredients WHERE product_id = ? AND business_id = ? ORDER BY inventory_item_id", [request.params.productId, request.params.businessId]);
      if (request.body?.expected_revision !== undefined && request.body.expected_revision !== recipeRevision(currentIngredients)) { await connection.rollback(); return reply.conflict("Recipe changed since it was loaded; reload it before saving"); }
      const ids = ingredients.map((entry) => entry.inventory_item_id);
      if (ids.some((id) => !validId(id)) || new Set(ids).size !== ids.length || ingredients.some((entry) => !positiveNumber(entry.quantity) || !hasDecimalScale(entry.quantity, 3) || Number(entry.quantity) > MAX_INVENTORY_QUANTITY || (entry.unit !== undefined && !units.has(entry.unit)))) { await connection.rollback(); return reply.badRequest("Recipe quantities must be positive and have at most 3 decimal places"); }
      const [items] = await connection.query(`SELECT id, unit FROM inventory_items WHERE business_id = ? AND active = TRUE AND id IN (${ids.map(() => "?").join(",")})`, [request.params.businessId, ...ids]);
      if (items.length !== ids.length) { await connection.rollback(); return reply.badRequest("Recipe contains an invalid inventory item"); }
      const itemById = new Map(items.map((item) => [item.id, item]));
      const normalizedIngredients = ingredients.map((entry) => {
        const item = itemById.get(entry.inventory_item_id);
        const unit = entry.unit || item.unit;
        return { inventory_item_id: item.id, quantity: convertQuantity(entry.quantity, unit, item.unit), unit: item.unit };
      });
      if (normalizedIngredients.some((entry) => entry.quantity === null || entry.quantity <= 0 || entry.quantity > MAX_INVENTORY_QUANTITY || !hasDecimalScale(entry.quantity, 3))) { await connection.rollback(); return reply.badRequest("Recipe quantity unit is incompatible with the inventory item or exceeds its supported precision"); }
      const [versionRows] = await connection.query("SELECT COALESCE(MAX(version), 0) AS version FROM product_recipe_versions WHERE product_id = ? AND business_id = ?", [request.params.productId, request.params.businessId]);
      const version = Number(versionRows[0].version) + 1;
      await connection.query("INSERT INTO product_recipe_versions (id, business_id, product_id, version, recipe_json, created_by) VALUES (?, ?, ?, ?, ?, ?)", [randomUUID(), request.params.businessId, request.params.productId, version, JSON.stringify(normalizedIngredients), request.user?.local ? null : request.user?.id || null]);
      await connection.query("DELETE FROM product_ingredients WHERE product_id = ? AND business_id = ?", [request.params.productId, request.params.businessId]);
      for (const entry of normalizedIngredients) await connection.query("INSERT INTO product_ingredients (id, business_id, product_id, inventory_item_id, quantity) VALUES (?, ?, ?, ?, ?)", [randomUUID(), request.params.businessId, request.params.productId, entry.inventory_item_id, entry.quantity]);
      await connection.commit();
      return { saved: true, ingredients: normalizedIngredients, revision: recipeRevision(normalizedIngredients), version };
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  });
}
