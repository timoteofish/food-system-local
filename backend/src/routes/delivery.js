import { createHash, randomBytes, randomUUID } from "node:crypto";
import { pool } from "../db.js";
import { requireBusinessAccess, requireRole } from "./auth.js";
import { audit } from "../audit.js";
import { hasDecimalScale } from "../numbers.js";
import { reserveOrderInventory } from "./orders.js";

const statuses = new Set(["requested", "assigned", "picked_up", "delivered", "cancelled", "failed"]);
const courierTransitions = new Map([
  ["assigned", new Set(["picked_up", "failed"])],
  ["picked_up", new Set(["delivered", "failed"])],
]);
const deliveryTransitions = new Map([
  ["requested", new Set(["assigned", "cancelled", "failed"])],
  ["assigned", new Set(["picked_up", "cancelled", "failed"])],
  ["picked_up", new Set(["delivered", "failed"])],
  ["delivered", new Set()],
  ["cancelled", new Set()],
  ["failed", new Set()],
]);
const hashToken = (token) => createHash("sha256").update(token).digest("hex");
export const parseCourierTokenDays = (value) => {
  if (value === undefined || value === "") return 30;
  if (typeof value !== "string" || !/^[0-9]+$/.test(value)) return null;
  const days = Number(value);
  return Number.isSafeInteger(days) && days >= 1 && days <= 3650 ? days : null;
};
const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const validId = (value) => typeof value === "string" && value.length > 0 && value.length <= 36;
const courierLocationWrites = new Map();
const clearCourierLocationIfInactive = async (connection, courierId, businessId) => {
  if (!courierId) return;
  await connection.query(
    "DELETE FROM courier_locations WHERE courier_id = ? AND business_id = ? AND NOT EXISTS (SELECT 1 FROM delivery_assignments WHERE courier_id = ? AND business_id = ? AND status IN ('assigned','picked_up'))",
    [courierId, businessId, courierId, businessId],
  );
};
const markOrderPickedUp = async (connection, businessId, orderId) => {
  if (!orderId) return;
  await connection.query("UPDATE orders SET status = 'out_for_delivery' WHERE id = ? AND business_id = ? AND status IN ('pending','confirmed','preparing','ready')", [orderId, businessId]);
};

const authenticateCourier = async (request, connection = pool) => {
  const token = String(request.headers["x-courier-token"] || "");
  if (!token) return null;
  const [rows] = await connection.query("SELECT id, business_id, name FROM delivery_couriers WHERE token_hash = ? AND active = TRUE AND token_expires_at > NOW() LIMIT 1", [hashToken(token)]);
  return rows[0] || null;
};

export default async function deliveryRoutes(app) {
  app.get("/api/v1/businesses/:businessId/couriers", async (request, reply) => {
    if (!(await requireBusinessAccess(request, reply))) return;
    const [couriers] = await pool.query("SELECT id, name, phone, active, created_at, updated_at FROM delivery_couriers WHERE business_id = ? ORDER BY name", [request.params.businessId]);
    return { couriers };
  });

  app.post("/api/v1/businesses/:businessId/couriers", async (request, reply) => {
    const user = await requireRole(request, reply);
    if (!user) return;
    if (!isPlainObject(request.body) || typeof request.body.name !== "string" || (request.body.phone !== undefined && request.body.phone !== null && typeof request.body.phone !== "string")) return reply.badRequest("Courier name and phone must be text");
    const name = request.body.name.trim();
    const phone = typeof request.body.phone === "string" ? request.body.phone.trim() : "";
    if (name.length < 2 || name.length > 160 || phone.length > 40) return reply.badRequest("Courier name or phone is outside the supported length");
    const id = randomUUID();
    await pool.query("INSERT INTO delivery_couriers (id, business_id, name, phone) VALUES (?, ?, ?, ?)", [id, request.params.businessId, name, phone]);
    await audit(request, user, "courier.created", "courier", id, { name });
    return reply.code(201).send({ courier: { id, business_id: request.params.businessId, name, phone, active: 1 } });
  });

  app.post("/api/v1/businesses/:businessId/couriers/:courierId/token", async (request, reply) => {
    const user = await requireRole(request, reply);
    if (!user) return;
    const expiresDays = parseCourierTokenDays(process.env.COURIER_TOKEN_DAYS);
    if (expiresDays === null) return reply.code(503).send({ error: "COURIER_TOKEN_DAYS must be an integer between 1 and 3650" });
    const token = randomBytes(32).toString("base64url");
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [couriers] = await connection.query("SELECT id FROM delivery_couriers WHERE id = ? AND business_id = ? AND active = TRUE LIMIT 1", [request.params.courierId, request.params.businessId]);
      if (!couriers.length) { await connection.rollback(); return reply.notFound("Courier not found"); }
      await connection.query("UPDATE delivery_couriers SET token_hash = ?, token_expires_at = DATE_ADD(NOW(), INTERVAL ? DAY) WHERE id = ? AND business_id = ?", [hashToken(token), expiresDays, request.params.courierId, request.params.businessId]);
      await audit(request, user, "courier.token_rotated", "courier", request.params.courierId, { expires_days: expiresDays }, connection);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    return { token, expires_in_days: expiresDays };
  });

  app.get("/api/v1/businesses/:businessId/couriers/locations", async (request, reply) => {
    if (!(await requireRole(request, reply))) return;
    const [locations] = await pool.query("SELECT c.id AS courier_id, c.name, c.phone, cl.latitude, cl.longitude, cl.accuracy_m, cl.created_at FROM delivery_couriers c LEFT JOIN courier_locations cl ON cl.courier_id = c.id AND cl.created_at >= NOW() - INTERVAL 15 MINUTE AND EXISTS (SELECT 1 FROM delivery_assignments active WHERE active.courier_id = c.id AND active.business_id = c.business_id AND active.status IN ('assigned','picked_up')) WHERE c.business_id = ? ORDER BY c.name", [request.params.businessId]);
    return { locations };
  });

  app.get("/api/v1/businesses/:businessId/deliveries", async (request, reply) => {
    if (!(await requireBusinessAccess(request, reply))) return;
    const view = request.query?.view;
    if (view !== undefined && view !== "queue") return reply.badRequest("Invalid delivery view");
    const from = view === "queue"
      ? "FROM (SELECT id FROM delivery_assignments WHERE business_id = ? AND status IN ('requested','assigned','picked_up','failed') UNION ALL SELECT id FROM (SELECT id FROM delivery_assignments WHERE business_id = ? AND status IN ('delivered','cancelled') ORDER BY updated_at DESC, id DESC LIMIT 50)) selected CROSS JOIN delivery_assignments da"
      : "FROM delivery_assignments da";
    const where = view === "queue" ? "da.id = selected.id AND da.business_id = ?" : "da.business_id = ?";
    const [deliveries] = await pool.query(`SELECT da.*, o.total, o.delivery_address, o.scheduled_for, c.name AS courier_name,
      CASE WHEN da.status = 'failed' AND o.delivery_address IS NOT NULL AND o.status IN ('pending','confirmed','preparing','ready','out_for_delivery') AND NOT EXISTS (
        SELECT 1 FROM delivery_assignments next WHERE next.business_id = da.business_id AND next.order_id = da.order_id AND next.status IN ('requested','assigned','picked_up','delivered')
      ) THEN 1 ELSE 0 END AS can_retry
      ${from} LEFT JOIN orders o ON o.id = da.order_id AND o.business_id = da.business_id LEFT JOIN delivery_couriers c ON c.id = da.courier_id AND c.business_id = da.business_id WHERE ${where} ORDER BY da.created_at DESC, da.id DESC`, view === "queue" ? [request.params.businessId, request.params.businessId, request.params.businessId] : [request.params.businessId]);
    return { deliveries };
  });

  app.post("/api/v1/businesses/:businessId/orders/:orderId/delivery", async (request, reply) => {
    const user = await requireRole(request, reply);
    if (!user) return;
    if (request.body !== undefined && !isPlainObject(request.body)) return reply.badRequest("Delivery data must be an object");
    const suppliedCourierId = request.body?.courier_id;
    if (suppliedCourierId !== undefined && suppliedCourierId !== null && suppliedCourierId !== "" && !validId(suppliedCourierId)) return reply.badRequest("Invalid courier id");
    const courierId = suppliedCourierId || null;
    const connection = await pool.getConnection();
    let id = randomUUID();
    let updatedExisting = false;
    const status = courierId ? "assigned" : "requested";
    try {
      await connection.beginTransaction();
      const [orders] = await connection.query("SELECT id, status FROM orders WHERE id = ? AND business_id = ? AND delivery_address IS NOT NULL FOR UPDATE", [request.params.orderId, request.params.businessId]);
      if (!orders.length) { await connection.rollback(); return reply.notFound("Delivery order not found"); }
      if (!["pending", "confirmed", "preparing", "ready", "out_for_delivery"].includes(orders[0].status)) { await connection.rollback(); return reply.conflict("Order cannot be assigned for delivery in its current status"); }
      const [delivered] = await connection.query("SELECT id FROM delivery_assignments WHERE order_id = ? AND business_id = ? AND status = 'delivered' LIMIT 1", [request.params.orderId, request.params.businessId]);
      if (delivered.length) { await connection.rollback(); return reply.conflict("Order has already been delivered"); }
      const [existing] = await connection.query("SELECT id, status FROM delivery_assignments WHERE order_id = ? AND business_id = ? AND status NOT IN ('delivered','cancelled','failed') LIMIT 1", [request.params.orderId, request.params.businessId]);
      if (existing.length && (existing[0].status !== "requested" || !courierId)) { await connection.rollback(); return reply.conflict("Order already has an active delivery"); }
      if (courierId) {
        const [couriers] = await connection.query("SELECT id, name FROM delivery_couriers WHERE id = ? AND business_id = ? AND active = TRUE LIMIT 1", [courierId, request.params.businessId]);
        if (!couriers.length) { await connection.rollback(); return reply.badRequest("Courier not found"); }
      }
      try { await reserveOrderInventory(connection, request.params.businessId, request.params.orderId, user.local ? null : user.id || null); }
      catch (error) { throw app.httpErrors.conflict(error.message); }
      if (existing.length) {
        id = existing[0].id;
        updatedExisting = true;
        await connection.query("UPDATE delivery_assignments SET courier_id = ?, courier_name = (SELECT name FROM delivery_couriers WHERE id = ?), status = 'assigned', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND business_id = ? AND status = 'requested'", [courierId, courierId, id, request.params.businessId]);
      } else {
        await connection.query("INSERT INTO delivery_assignments (id, business_id, order_id, courier_id, provider, status, courier_name, payload) VALUES (?, ?, ?, ?, 'local', ?, (SELECT name FROM delivery_couriers WHERE id = ?), ?)", [id, request.params.businessId, request.params.orderId, courierId, status, courierId, JSON.stringify({ source: "local" })]);
      }
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    await audit(request, user, "delivery.created", "delivery", id, { order_id: request.params.orderId, courier_id: courierId });
    return reply.code(updatedExisting ? 200 : 201).send({ delivery: { id, order_id: request.params.orderId, courier_id: courierId, status } });
  });

  app.patch("/api/v1/businesses/:businessId/deliveries/:id", async (request, reply) => {
    const user = await requireRole(request, reply);
    if (!user) return;
    const status = isPlainObject(request.body) && typeof request.body.status === "string" ? request.body.status : "";
    if (!statuses.has(status)) return reply.badRequest("Invalid delivery status");
    const reason = request.body.failure_reason;
    if (reason !== undefined && reason !== null && (status !== "failed" || typeof reason !== "string" || reason.length > 500)) return reply.badRequest("Delivery failure reason must be text up to 500 characters for a failed delivery");
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query("SELECT status, courier_id, order_id FROM delivery_assignments WHERE id = ? AND business_id = ? LIMIT 1 FOR UPDATE", [request.params.id, request.params.businessId]);
      if (!rows.length) { await connection.rollback(); return reply.notFound("Delivery not found"); }
      if (!deliveryTransitions.get(rows[0].status)?.has(status)) { await connection.rollback(); return reply.conflict("Delivery status cannot move backwards or leave a terminal state"); }
      const [result] = await connection.query("UPDATE delivery_assignments SET status = ?, failure_reason = ? WHERE id = ? AND business_id = ? AND status = ?", [status, status === "failed" ? reason?.trim() || null : null, request.params.id, request.params.businessId, rows[0].status]);
      if (!result.affectedRows) { await connection.rollback(); return reply.conflict("Delivery status changed; reload and try again"); }
      if (status === "picked_up") await markOrderPickedUp(connection, request.params.businessId, rows[0].order_id);
      if (["delivered", "cancelled", "failed"].includes(status)) await clearCourierLocationIfInactive(connection, rows[0].courier_id, request.params.businessId);
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    await audit(request, user, "delivery.status_updated", "delivery", request.params.id, { status });
    return { updated: true, status };
  });

  app.get("/api/v1/courier/deliveries", async (request, reply) => {
    const courier = await authenticateCourier(request);
    if (!courier) return reply.unauthorized("Courier token is invalid or expired");
    const [deliveries] = await pool.query("SELECT da.id, da.order_id, da.status, da.created_at, o.total, o.delivery_address, o.scheduled_for FROM delivery_assignments da JOIN orders o ON o.id = da.order_id WHERE da.courier_id = ? AND (da.status IN ('assigned','picked_up') OR (da.status = 'delivered' AND da.updated_at >= NOW() - INTERVAL 1 DAY)) ORDER BY da.created_at DESC", [courier.id]);
    return { courier: { id: courier.id, name: courier.name }, deliveries };
  });

  app.patch("/api/v1/courier/deliveries/:id", async (request, reply) => {
    const courier = await authenticateCourier(request);
    if (!courier) return reply.unauthorized("Courier token is invalid or expired");
    const status = isPlainObject(request.body) && typeof request.body.status === "string" ? request.body.status : "";
    if (!courierTransitions.get("assigned").has(status) && !courierTransitions.get("picked_up").has(status)) return reply.badRequest("Invalid courier delivery status");
    const reason = request.body.failure_reason;
    if (reason !== undefined && reason !== null && (status !== "failed" || typeof reason !== "string" || reason.length > 500)) return reply.badRequest("Delivery failure reason must be text up to 500 characters for a failed delivery");
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const currentCourier = await authenticateCourier(request, connection);
      if (!currentCourier || currentCourier.id !== courier.id) { await connection.rollback(); return reply.unauthorized("Courier token is invalid or expired"); }
      const [rows] = await connection.query("SELECT status, order_id FROM delivery_assignments WHERE id = ? AND courier_id = ? AND business_id = ? LIMIT 1 FOR UPDATE", [request.params.id, courier.id, courier.business_id]);
      if (!rows.length) { await connection.rollback(); return reply.notFound("Delivery not found"); }
      if (!courierTransitions.get(rows[0].status)?.has(status)) { await connection.rollback(); return reply.conflict("Invalid courier delivery status transition"); }
      const [result] = await connection.query("UPDATE delivery_assignments SET status = ?, failure_reason = ? WHERE id = ? AND courier_id = ? AND business_id = ? AND status = ?", [status, status === "failed" ? reason?.trim() || null : null, request.params.id, courier.id, courier.business_id, rows[0].status]);
      if (!result.affectedRows) { await connection.rollback(); return reply.conflict("Delivery status changed; reload and try again"); }
      if (status === "picked_up") await markOrderPickedUp(connection, courier.business_id, rows[0].order_id);
      if (["delivered", "failed"].includes(status)) await clearCourierLocationIfInactive(connection, courier.id, courier.business_id);
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    return { updated: true, status };
  });

  app.post("/api/v1/courier/location", async (request, reply) => {
    const courier = await authenticateCourier(request);
    if (!courier) return reply.unauthorized("Courier token is invalid or expired");
    const now = Date.now();
    if (courierLocationWrites.size >= 1024) {
      for (const [id, lastWrite] of courierLocationWrites) if (now - lastWrite >= 5_000) courierLocationWrites.delete(id);
    }
    if (!isPlainObject(request.body)) return reply.badRequest("Courier location must be an object");
    const { latitude, longitude } = request.body;
    const accuracy = request.body.accuracy_m === undefined ? null : request.body.accuracy_m;
    if (typeof latitude !== "number" || !hasDecimalScale(latitude, 7) || latitude < -90 || latitude > 90 || typeof longitude !== "number" || !hasDecimalScale(longitude, 7) || longitude < -180 || longitude > 180 || (accuracy !== null && (typeof accuracy !== "number" || !hasDecimalScale(accuracy, 2) || accuracy < 0 || accuracy > 99_999_999.99))) return reply.badRequest("Invalid courier location");
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const currentCourier = await authenticateCourier(request, connection);
      if (!currentCourier || currentCourier.id !== courier.id) { await connection.rollback(); return reply.unauthorized("Courier token is invalid or expired"); }
      const [activeDeliveries] = await connection.query("SELECT id FROM delivery_assignments WHERE courier_id = ? AND business_id = ? AND status IN ('assigned','picked_up') LIMIT 1 FOR UPDATE", [courier.id, courier.business_id]);
      if (!activeDeliveries.length) { await connection.rollback(); return reply.conflict("Location sharing is available only during an active delivery"); }
      const lastWrite = courierLocationWrites.get(courier.id);
      if (lastWrite !== undefined && now - lastWrite < 5_000) {
        await connection.rollback();
        reply.header("Retry-After", "5");
        return reply.code(429).send({ error: "Courier location was updated too recently" });
      }
      if (lastWrite === undefined && courierLocationWrites.size >= 4096) {
        await connection.rollback();
        reply.header("Retry-After", "5");
        return reply.code(429).send({ error: "Courier location updates are temporarily rate limited" });
      }
      courierLocationWrites.set(courier.id, now);
      await connection.query("INSERT INTO courier_locations (id, courier_id, business_id, latitude, longitude, accuracy_m) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(courier_id) DO UPDATE SET business_id = excluded.business_id, latitude = excluded.latitude, longitude = excluded.longitude, accuracy_m = excluded.accuracy_m, created_at = CURRENT_TIMESTAMP", [randomUUID(), courier.id, courier.business_id, latitude.toFixed(7), longitude.toFixed(7), accuracy === null ? null : accuracy.toFixed(2)]);
      await connection.commit();
    } catch (error) {
      if (courierLocationWrites.get(courier.id) === now) courierLocationWrites.delete(courier.id);
      await connection.rollback();
      throw error;
    } finally { connection.release(); }
    return { recorded: true };
  });
}
