import { createHash, randomBytes, randomUUID } from "node:crypto";
import { pool } from "../db.js";
import { requireBusinessAccess, requireRole } from "./auth.js";
import { audit } from "../audit.js";

const statuses = new Set(["requested", "assigned", "picked_up", "delivered", "cancelled", "failed"]);
const courierStatuses = new Set(["assigned", "picked_up", "delivered", "failed"]);
const hashToken = (token) => createHash("sha256").update(token).digest("hex");

const authenticateCourier = async (request) => {
  const token = String(request.headers["x-courier-token"] || "");
  if (!token) return null;
  const [rows] = await pool.query("SELECT id, business_id, name FROM delivery_couriers WHERE token_hash = ? AND active = TRUE AND token_expires_at > NOW() LIMIT 1", [hashToken(token)]);
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
    const name = String(request.body?.name || "").trim();
    const phone = String(request.body?.phone || "").trim().slice(0, 40) || null;
    if (name.length < 2 || name.length > 160) return reply.badRequest("Courier name is required");
    const id = randomUUID();
    await pool.query("INSERT INTO delivery_couriers (id, business_id, name, phone) VALUES (?, ?, ?, ?)", [id, request.params.businessId, name, phone]);
    await audit(request, user, "courier.created", "courier", id, { name });
    return reply.code(201).send({ courier: { id, business_id: request.params.businessId, name, phone, active: 1 } });
  });

  app.post("/api/v1/businesses/:businessId/couriers/:courierId/token", async (request, reply) => {
    const user = await requireRole(request, reply);
    if (!user) return;
    const [couriers] = await pool.query("SELECT id FROM delivery_couriers WHERE id = ? AND business_id = ? AND active = TRUE LIMIT 1", [request.params.courierId, request.params.businessId]);
    if (!couriers.length) return reply.notFound("Courier not found");
    const token = randomBytes(32).toString("base64url");
    const expiresDays = Math.max(1, Number(process.env.COURIER_TOKEN_DAYS || 30));
    await pool.query("UPDATE delivery_couriers SET token_hash = ?, token_expires_at = DATE_ADD(NOW(), INTERVAL ? DAY) WHERE id = ? AND business_id = ?", [hashToken(token), expiresDays, request.params.courierId, request.params.businessId]);
    await audit(request, user, "courier.token_rotated", "courier", request.params.courierId, { expires_days: expiresDays });
    return { token, expires_in_days: expiresDays };
  });

  app.get("/api/v1/businesses/:businessId/couriers/locations", async (request, reply) => {
    if (!(await requireBusinessAccess(request, reply))) return;
    const [locations] = await pool.query("SELECT c.id AS courier_id, c.name, c.phone, cl.latitude, cl.longitude, cl.accuracy_m, cl.created_at FROM delivery_couriers c LEFT JOIN courier_locations cl ON cl.id = (SELECT latest.id FROM courier_locations latest WHERE latest.courier_id = c.id ORDER BY latest.created_at DESC LIMIT 1) WHERE c.business_id = ? ORDER BY c.name", [request.params.businessId]);
    return { locations };
  });

  app.get("/api/v1/businesses/:businessId/deliveries", async (request, reply) => {
    if (!(await requireBusinessAccess(request, reply))) return;
    const [deliveries] = await pool.query("SELECT da.*, o.total, o.delivery_address, o.scheduled_for, c.name AS courier_name FROM delivery_assignments da LEFT JOIN orders o ON o.id = da.order_id LEFT JOIN delivery_couriers c ON c.id = da.courier_id WHERE da.business_id = ? ORDER BY da.created_at DESC", [request.params.businessId]);
    return { deliveries };
  });

  app.post("/api/v1/businesses/:businessId/orders/:orderId/delivery", async (request, reply) => {
    const user = await requireRole(request, reply);
    if (!user) return;
    const [orders] = await pool.query("SELECT id, status, delivery_address FROM orders WHERE id = ? AND business_id = ? AND delivery_address IS NOT NULL LIMIT 1", [request.params.orderId, request.params.businessId]);
    if (!orders.length) return reply.notFound("Delivery order not found");
    const [existing] = await pool.query("SELECT id FROM delivery_assignments WHERE order_id = ? AND business_id = ? AND status NOT IN ('delivered','cancelled','failed') LIMIT 1", [request.params.orderId, request.params.businessId]);
    if (existing.length) return reply.conflict("Order already has an active delivery");
    const courierId = request.body?.courier_id || null;
    if (courierId) {
      const [couriers] = await pool.query("SELECT id, name FROM delivery_couriers WHERE id = ? AND business_id = ? AND active = TRUE LIMIT 1", [courierId, request.params.businessId]);
      if (!couriers.length) return reply.badRequest("Courier not found");
    }
    const id = randomUUID();
    const status = courierId ? "assigned" : "requested";
    await pool.query("INSERT INTO delivery_assignments (id, business_id, order_id, courier_id, provider, status, courier_name, payload) VALUES (?, ?, ?, ?, 'local', ?, (SELECT name FROM delivery_couriers WHERE id = ?), ?)", [id, request.params.businessId, request.params.orderId, courierId, status, courierId, JSON.stringify({ source: "local" })]);
    await pool.query("UPDATE orders SET status = ? WHERE id = ? AND business_id = ? AND status IN ('pending','confirmed','preparing','ready')", [status === "assigned" ? "out_for_delivery" : "ready", request.params.orderId, request.params.businessId]);
    await audit(request, user, "delivery.created", "delivery", id, { order_id: request.params.orderId, courier_id: courierId });
    return reply.code(201).send({ delivery: { id, order_id: request.params.orderId, courier_id: courierId, status } });
  });

  app.patch("/api/v1/businesses/:businessId/deliveries/:id", async (request, reply) => {
    const user = await requireRole(request, reply);
    if (!user) return;
    const status = String(request.body?.status || "");
    if (!statuses.has(status)) return reply.badRequest("Invalid delivery status");
    const [result] = await pool.query("UPDATE delivery_assignments SET status = ? WHERE id = ? AND business_id = ?", [status, request.params.id, request.params.businessId]);
    if (!result.affectedRows) return reply.notFound("Delivery not found");
    await audit(request, user, "delivery.status_updated", "delivery", request.params.id, { status });
    return { updated: true, status };
  });

  app.get("/api/v1/courier/deliveries", async (request, reply) => {
    const courier = await authenticateCourier(request);
    if (!courier) return reply.unauthorized("Courier token is invalid or expired");
    const [deliveries] = await pool.query("SELECT da.id, da.order_id, da.status, da.created_at, o.total, o.delivery_address, o.scheduled_for FROM delivery_assignments da JOIN orders o ON o.id = da.order_id WHERE da.courier_id = ? ORDER BY da.created_at DESC", [courier.id]);
    return { courier, deliveries };
  });

  app.patch("/api/v1/courier/deliveries/:id", async (request, reply) => {
    const courier = await authenticateCourier(request);
    if (!courier) return reply.unauthorized("Courier token is invalid or expired");
    const status = String(request.body?.status || "");
    if (!courierStatuses.has(status)) return reply.badRequest("Invalid courier delivery status");
    const [result] = await pool.query("UPDATE delivery_assignments SET status = ? WHERE id = ? AND courier_id = ? AND business_id = ? AND status NOT IN ('delivered','cancelled','failed')", [status, request.params.id, courier.id, courier.business_id]);
    if (!result.affectedRows) return reply.notFound("Delivery not found");
    return { updated: true, status };
  });

  app.post("/api/v1/courier/location", async (request, reply) => {
    const courier = await authenticateCourier(request);
    if (!courier) return reply.unauthorized("Courier token is invalid or expired");
    const latitude = Number(request.body?.latitude);
    const longitude = Number(request.body?.longitude);
    const accuracy = request.body?.accuracy_m === undefined ? null : Number(request.body.accuracy_m);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180 || (accuracy !== null && (!Number.isFinite(accuracy) || accuracy < 0))) return reply.badRequest("Invalid courier location");
    await pool.query("INSERT INTO courier_locations (id, courier_id, business_id, latitude, longitude, accuracy_m) VALUES (?, ?, ?, ?, ?, ?)", [randomUUID(), courier.id, courier.business_id, latitude.toFixed(7), longitude.toFixed(7), accuracy === null ? null : accuracy.toFixed(2)]);
    return { recorded: true };
  });
}
