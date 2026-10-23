import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { pool } from "../db.js";
import { requireBusinessAccess, requireRole } from "./auth.js";
import { audit } from "../audit.js";
import { decryptSecret, encryptSecret, hasSecretKey } from "../security.js";

const providers = new Set(["ifood", "99food", "keeta", "delivery_logistics", "payment"]);
const connectionStatuses = new Set(["disconnected", "pending", "connected", "error", "disabled"]);
const externalStatuses = new Set(["received", "accepted", "preparing", "ready", "out_for_delivery", "completed", "cancelled", "failed"]);
const localOrderStatus = { received: "pending", accepted: "confirmed", preparing: "preparing", ready: "ready", out_for_delivery: "out_for_delivery", completed: "completed", cancelled: "cancelled", failed: "cancelled" };

const json = (value, fallback = {}) => value && typeof value === "object" ? value : fallback;

const validWebhookSignature = async (request, businessId, integrationId) => {
  const signature = String(request.headers["x-integration-signature"] || "");
  if (!/^sha256=[a-f0-9]{64}$/i.test(signature)) return false;
  const [secrets] = await pool.query("SELECT encrypted_value FROM secure_secrets WHERE business_id = ? AND secret_name = ? LIMIT 1", [businessId, `integration:${integrationId}`]);
  if (!secrets.length) return false;
  let credentials;
  try { credentials = JSON.parse(decryptSecret(secrets[0].encrypted_value)); } catch { return false; }
  const secret = String(credentials.webhook_secret || "");
  if (!secret) return false;
  const payload = JSON.stringify(request.body || {});
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`);
  const received = Buffer.from(signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
};

export default async function integrationRoutes(app) {
  app.get("/api/v1/businesses/:businessId/integrations", async (request, reply) => {
    const user = await requireRole(request, reply);
    if (!user) return;
    const [connections] = await pool.query(
      "SELECT id, business_id, provider, display_name, status, settings, last_error, last_synced_at, created_at, updated_at FROM integration_connections WHERE business_id = ? ORDER BY display_name",
      [request.params.businessId],
    );
    return { connections };
  });

  app.post("/api/v1/businesses/:businessId/integrations", async (request, reply) => {
    const user = await requireRole(request, reply);
    if (!user) return;
    const body = request.body || {};
    const provider = String(body.provider || "");
    if (!providers.has(provider)) return reply.badRequest("Invalid integration provider");
    if (body.credentials) return reply.badRequest("Integration credentials are not available until secure storage is configured");
    const id = randomUUID();
    await pool.query(
      "INSERT INTO integration_connections (id, business_id, provider, display_name, status, settings) VALUES (?, ?, ?, ?, 'disconnected', ?)",
      [id, request.params.businessId, provider, String(body.display_name || provider).slice(0, 120), JSON.stringify(json(body.settings))],
    );
    await audit(request, user, "integration.created", "integration", id, { provider });
    return reply.code(201).send({ connection: { id, business_id: request.params.businessId, provider, status: "disconnected" } });
  });

  app.patch("/api/v1/businesses/:businessId/integrations/:id", async (request, reply) => {
    const user = await requireRole(request, reply);
    if (!user) return;
    const body = request.body || {};
    const status = String(body.status || "");
    if (status && !connectionStatuses.has(status)) return reply.badRequest("Invalid integration status");
    const [result] = await pool.query(
      "UPDATE integration_connections SET display_name = COALESCE(?, display_name), status = COALESCE(?, status), settings = COALESCE(?, settings), last_error = CASE WHEN ? = 'connected' THEN NULL ELSE last_error END WHERE id = ? AND business_id = ?",
      [body.display_name ? String(body.display_name).slice(0, 120) : null, status || null, body.settings ? JSON.stringify(json(body.settings)) : null, status, request.params.id, request.params.businessId],
    );
    if (!result.affectedRows) return reply.notFound("Integration not found");
    await audit(request, user, "integration.updated", "integration", request.params.id, { status });
    return { updated: true };
  });

  app.post("/api/v1/businesses/:businessId/integrations/:id/credentials", async (request, reply) => {
    const user = await requireRole(request, reply);
    if (!user) return;
    if (!hasSecretKey()) return reply.code(503).send({ error: "FOOD_SYSTEM_SECRET_KEY is not configured" });
    const credentials = request.body?.credentials;
    if (!credentials || typeof credentials !== "object" || Array.isArray(credentials)) return reply.badRequest("Credentials are required");
    const [connections] = await pool.query("SELECT id FROM integration_connections WHERE id = ? AND business_id = ? LIMIT 1", [request.params.id, request.params.businessId]);
    if (!connections.length) return reply.notFound("Integration not found");
    await pool.query(
      "INSERT INTO secure_secrets (id, business_id, secret_name, encrypted_value) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE encrypted_value = VALUES(encrypted_value), updated_at = CURRENT_TIMESTAMP",
      [randomUUID(), request.params.businessId, `integration:${request.params.id}`, encryptSecret(JSON.stringify(credentials))],
    );
    await pool.query("UPDATE integration_connections SET status = 'pending', last_error = NULL WHERE id = ? AND business_id = ?", [request.params.id, request.params.businessId]);
    await audit(request, user, "integration.credentials_updated", "integration", request.params.id, { fields: Object.keys(credentials) });
    return { stored: true };
  });

  app.post("/api/v1/businesses/:businessId/integrations/:id/test", async (request, reply) => {
    const user = await requireRole(request, reply);
    if (!user) return;
    if (!hasSecretKey()) return reply.code(503).send({ error: "FOOD_SYSTEM_SECRET_KEY is not configured" });
    const [connections] = await pool.query("SELECT id, provider, settings FROM integration_connections WHERE id = ? AND business_id = ? LIMIT 1", [request.params.id, request.params.businessId]);
    if (!connections.length) return reply.notFound("Integration not found");
    let settings;
    try { settings = typeof connections[0].settings === "string" ? JSON.parse(connections[0].settings) : connections[0].settings || {}; } catch { return reply.code(500).send({ error: "Integration settings are invalid" }); }
    if (!settings.test_url || !/^https:\/\//i.test(settings.test_url)) return reply.badRequest("Integration test_url must use HTTPS");
    const [secrets] = await pool.query("SELECT encrypted_value FROM secure_secrets WHERE business_id = ? AND secret_name = ? LIMIT 1", [request.params.businessId, `integration:${request.params.id}`]);
    if (!secrets.length) return reply.code(503).send({ error: "Integration credentials are not configured" });
    let credentials;
    try { credentials = JSON.parse(decryptSecret(secrets[0].encrypted_value)); } catch { return reply.code(503).send({ error: "Integration credentials are invalid" }); }
    const headers = { Accept: "application/json" };
    if (credentials.api_token) headers.Authorization = `Bearer ${credentials.api_token}`;
    try {
      const response = await fetch(settings.test_url, { headers, signal: AbortSignal.timeout(10000) });
      await pool.query("UPDATE integration_connections SET status = ?, last_error = ?, last_synced_at = CURRENT_TIMESTAMP WHERE id = ? AND business_id = ?", [response.ok ? "connected" : "error", response.ok ? null : `HTTP ${response.status}`, request.params.id, request.params.businessId]);
      await audit(request, user, "integration.tested", "integration", request.params.id, { provider: connections[0].provider, http_status: response.status, success: response.ok });
      return { connected: response.ok, status: response.status, provider: connections[0].provider };
    } catch {
      await pool.query("UPDATE integration_connections SET status = 'error', last_error = 'Connection failed' WHERE id = ? AND business_id = ?", [request.params.id, request.params.businessId]);
      await audit(request, user, "integration.test_failed", "integration", request.params.id, { provider: connections[0].provider });
      return reply.code(502).send({ error: "Integration connection failed" });
    }
  });

  app.post("/api/v1/businesses/:businessId/integrations/:id/events", async (request, reply) => {
    if (request.headers.authorization) {
      if (!(await requireBusinessAccess(request, reply))) return;
    } else if (!(await validWebhookSignature(request, request.params.businessId, request.params.id))) {
      return reply.unauthorized("Invalid integration signature");
    }
    const body = request.body || {};
    if (!body.event_type) return reply.badRequest("event_type is required");
    if (body.event_type === "order.received" && !body.external_order_id) return reply.badRequest("external_order_id is required for order.received");
    const [connections] = await pool.query("SELECT id FROM integration_connections WHERE id = ? AND business_id = ? LIMIT 1", [request.params.id, request.params.businessId]);
    if (!connections.length) return reply.notFound("Integration not found");
    const eventId = randomUUID();
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query(
        "INSERT INTO integration_events (id, business_id, integration_connection_id, external_order_id, direction, event_type, payload) VALUES (?, ?, ?, ?, 'inbound', ?, ?)",
        [eventId, request.params.businessId, request.params.id, body.external_order_id || null, String(body.event_type).slice(0, 80), JSON.stringify(json(body.payload))],
      );
      let externalOrder = null;
      if (body.event_type === "order.received") {
        const [existing] = await connection.query("SELECT id, status FROM external_orders WHERE integration_connection_id = ? AND external_order_id = ? LIMIT 1", [request.params.id, body.external_order_id]);
        if (existing.length) {
          externalOrder = existing[0];
        } else {
          const externalOrderId = randomUUID();
          await connection.query(
            "INSERT INTO external_orders (id, business_id, integration_connection_id, external_order_id, status, payload) VALUES (?, ?, ?, ?, 'received', ?)",
            [externalOrderId, request.params.businessId, request.params.id, String(body.external_order_id).slice(0, 190), JSON.stringify(json(body.payload))],
          );
          externalOrder = { id: externalOrderId, status: "received" };
        }
        await connection.query("UPDATE integration_events SET status = 'processed', processed_at = CURRENT_TIMESTAMP WHERE id = ?", [eventId]);
      }
      await connection.commit();
      return reply.code(202).send({ event: { id: eventId, status: body.event_type === "order.received" ? "processed" : "pending" }, external_order: externalOrder });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  });

  app.get("/api/v1/businesses/:businessId/external-orders", async (request, reply) => {
    if (!(await requireBusinessAccess(request, reply))) return;
    const [orders] = await pool.query(
      "SELECT eo.*, ic.provider, ic.display_name FROM external_orders eo JOIN integration_connections ic ON ic.id = eo.integration_connection_id WHERE eo.business_id = ? ORDER BY eo.received_at DESC",
      [request.params.businessId],
    );
    return { orders };
  });

  app.patch("/api/v1/businesses/:businessId/external-orders/:id", async (request, reply) => {
    const user = await requireRole(request, reply);
    if (!user) return;
    const status = String(request.body?.status || "");
    const orderId = request.body?.order_id || null;
    if (status && !externalStatuses.has(status)) return reply.badRequest("Invalid external order status");
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [externalOrders] = await connection.query("SELECT id, order_id, status FROM external_orders WHERE id = ? AND business_id = ? FOR UPDATE", [request.params.id, request.params.businessId]);
      if (!externalOrders.length) { await connection.rollback(); return reply.notFound("External order not found"); }
      if (orderId) {
        const [orders] = await connection.query("SELECT id FROM orders WHERE id = ? AND business_id = ? LIMIT 1", [orderId, request.params.businessId]);
        if (!orders.length) { await connection.rollback(); return reply.badRequest("Order does not belong to this business"); }
      }
      await connection.query("UPDATE external_orders SET status = COALESCE(?, status), order_id = COALESCE(?, order_id), last_error = NULL WHERE id = ? AND business_id = ?", [status || null, orderId, request.params.id, request.params.businessId]);
      if (orderId && status) {
        await connection.query("UPDATE orders SET status = ? WHERE id = ? AND business_id = ?", [localOrderStatus[status], orderId, request.params.businessId]);
      }
      await connection.commit();
      await audit(request, user, "external_order.updated", "external_order", request.params.id, { status: status || null, order_id: orderId });
      return { updated: true, external_order: { id: request.params.id, status: status || externalOrders[0].status, order_id: orderId || externalOrders[0].order_id } };
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  });
}
