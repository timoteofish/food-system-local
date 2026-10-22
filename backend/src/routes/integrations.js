import { randomUUID } from "node:crypto";
import { pool } from "../db.js";
import { requireBusinessAccess } from "./auth.js";

const providers = new Set(["ifood", "99food", "keeta", "delivery_logistics", "payment"]);
const connectionStatuses = new Set(["disconnected", "pending", "connected", "error", "disabled"]);

const json = (value, fallback = {}) => value && typeof value === "object" ? value : fallback;

export default async function integrationRoutes(app) {
  app.get("/api/v1/businesses/:businessId/integrations", async (request, reply) => {
    if (!(await requireBusinessAccess(request, reply))) return;
    const [connections] = await pool.query(
      "SELECT id, business_id, provider, display_name, status, settings, last_error, last_synced_at, created_at, updated_at FROM integration_connections WHERE business_id = ? ORDER BY display_name",
      [request.params.businessId],
    );
    return { connections };
  });

  app.post("/api/v1/businesses/:businessId/integrations", async (request, reply) => {
    if (!(await requireBusinessAccess(request, reply))) return;
    const body = request.body || {};
    const provider = String(body.provider || "");
    if (!providers.has(provider)) return reply.badRequest("Invalid integration provider");
    if (body.credentials) return reply.badRequest("Integration credentials are not available until secure storage is configured");
    const id = randomUUID();
    await pool.query(
      "INSERT INTO integration_connections (id, business_id, provider, display_name, status, credentials, settings) VALUES (?, ?, ?, ?, 'disconnected', ?, ?)",
      [id, request.params.businessId, provider, String(body.display_name || provider).slice(0, 120), null, JSON.stringify(json(body.settings))],
    );
    return reply.code(201).send({ connection: { id, business_id: request.params.businessId, provider, status: "disconnected" } });
  });

  app.patch("/api/v1/businesses/:businessId/integrations/:id", async (request, reply) => {
    if (!(await requireBusinessAccess(request, reply))) return;
    const body = request.body || {};
    const status = String(body.status || "");
    if (status && !connectionStatuses.has(status)) return reply.badRequest("Invalid integration status");
    const [result] = await pool.query(
      "UPDATE integration_connections SET display_name = COALESCE(?, display_name), status = COALESCE(?, status), settings = COALESCE(?, settings), last_error = CASE WHEN ? = 'connected' THEN NULL ELSE last_error END WHERE id = ? AND business_id = ?",
      [body.display_name ? String(body.display_name).slice(0, 120) : null, status || null, body.settings ? JSON.stringify(json(body.settings)) : null, status, request.params.id, request.params.businessId],
    );
    if (!result.affectedRows) return reply.notFound("Integration not found");
    return { updated: true };
  });

  app.post("/api/v1/businesses/:businessId/integrations/:id/events", async (request, reply) => {
    if (!(await requireBusinessAccess(request, reply))) return;
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
}
