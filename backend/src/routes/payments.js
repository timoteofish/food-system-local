import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { pool } from "../db.js";
import { requireRole } from "./auth.js";
import { audit } from "../audit.js";
import { decryptSecret, encryptSecret, hasSecretKey } from "../security.js";
import { isPublicAddress, requestPublicHttps } from "../outbound-request.js";
import {
  TERMINAL_PROVIDERS,
  GATEWAY_PROVIDERS,
  buildTerminalCharge,
  normalizeTerminalResponse,
  buildGatewayCheckout,
  normalizeGatewayCheckout,
  normalizeGatewayWebhook,
} from "../payment-adapters.js";

const MAX_PAYLOAD_BYTES = 64 * 1024;
const MAX_WEBHOOK_BYTES = 256 * 1024;
const checkoutStatuses = new Set(["pending", "approved", "declined", "voided", "error"]);
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const isValidEndpoint = (raw) => {
  if (typeof raw !== "string" || !raw.trim()) return false;
  let url;
  try { url = new URL(raw); }
  catch { return false; }
  if (url.username || url.password || url.hash) return false;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (url.protocol === "https:") return !url.username && !url.password;
  if (url.protocol !== "http:") return false;
  // Loopback and RFC1918 addresses are allowed for local terminals.
  if (["localhost", "127.0.0.1", "::1"].includes(host)) return true;
  if (isIP(host) === 4) return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
  return false;
};

const isValidCheckoutUrl = (raw) => {
  try {
    const url = new URL(raw);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password;
  } catch { return false; }
};

const readSecret = async (businessId, secretName) => {
  const [rows] = await pool.query(
    "SELECT encrypted_value FROM secure_secrets WHERE business_id = ? AND secret_name = ? LIMIT 1",
    [businessId, secretName],
  );
  if (!rows.length || !hasSecretKey()) return null;
  try { return JSON.parse(decryptSecret(rows[0].encrypted_value)); }
  catch { return null; }
};

const writeSecret = async (businessId, secretName, value) => {
  await pool.query(
    "INSERT INTO secure_secrets (id, business_id, secret_name, encrypted_value) VALUES (?, ?, ?, ?) ON CONFLICT(business_id, secret_name) DO UPDATE SET encrypted_value = excluded.encrypted_value, updated_at = CURRENT_TIMESTAMP",
    [randomUUID(), businessId, secretName, encryptSecret(JSON.stringify(value))],
  );
};

const postJson = async (url, body, headers = {}) => {
  if (Buffer.byteLength(JSON.stringify(body), "utf8") > MAX_PAYLOAD_BYTES) throw new Error("Payment request exceeds the 64 KB limit");
  if (url.protocol === "https:") {
    const result = await requestPublicHttps(url, { method: "POST", body: JSON.stringify(body), headers });
    let parsed = {};
    try { parsed = JSON.parse(result.body || "{}"); } catch { parsed = {}; }
    return { status: result.status, body: parsed };
  }
  if (!isValidEndpoint(url.toString())) throw new Error("Payment endpoint must be loopback or a private-network HTTP address");
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
    body: JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  const text = await response.text();
  let parsed = {};
  try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = {}; }
  return { status: response.status, body: parsed };
};

const findOrder = async (businessId, orderId) => {
  const [rows] = await pool.query("SELECT id, total, status FROM orders WHERE id = ? AND business_id = ? LIMIT 1", [orderId, businessId]);
  return rows[0] || null;
};

const validWebhookSignature = (request, secret, rawBody) => {
  const signature = String(request.headers["x-payment-signature"] || "");
  if (!/^sha256=[a-f0-9]{64}$/i.test(signature) || !secret) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`);
  const received = Buffer.from(signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
};

export default async function paymentRoutes(app) {
  app.get("/api/v1/businesses/:businessId/payment-terminals", async (request, reply) => {
    if (!(await requireRole(request, reply))) return;
    const [rows] = await pool.query(
      "SELECT id, business_id, provider, display_name, endpoint_url, active, created_at, updated_at FROM payment_terminals WHERE business_id = ? ORDER BY display_name",
      [request.params.businessId],
    );
    return { terminals: rows };
  });

  app.post("/api/v1/businesses/:businessId/payment-terminals", async (request, reply) => {
    if (!(await requireRole(request, reply))) return;
    if (!hasSecretKey()) return reply.code(503).send({ error: "FOOD_SYSTEM_SECRET_KEY is not configured" });
    const body = request.body;
    if (!isObject(body)) return reply.badRequest("Terminal data must be an object");
    const provider = typeof body.provider === "string" ? body.provider : "";
    if (!TERMINAL_PROVIDERS.includes(provider)) return reply.badRequest("Invalid terminal provider");
    const displayName = typeof body.display_name === "string" ? body.display_name.trim() : "";
    if (!displayName || displayName.length > 120) return reply.badRequest("Terminal name must contain 1 to 120 characters");
    if (!isValidEndpoint(body.endpoint_url)) return reply.badRequest("Terminal endpoint must be loopback or a private-network HTTP address, or public HTTPS");
    const token = body.access_token === undefined ? "" : String(body.access_token);
    if (token && (token.length < 8 || token.length > 4096)) return reply.badRequest("access_token must contain 8 to 4096 characters");
    const id = randomUUID();
    await pool.query(
      "INSERT INTO payment_terminals (id, business_id, provider, display_name, endpoint_url, active) VALUES (?, ?, ?, ?, ?, ?)",
      [id, request.params.businessId, provider, displayName, String(body.endpoint_url).trim(), body.active === false ? 0 : 1],
    );
    if (token) await writeSecret(request.params.businessId, `payment:terminal:${id}`, { access_token: token });
    await audit(request, request.user, "payment_terminal.created", "payment_terminal", id, { provider });
    return reply.code(201).send({ terminal: { id, business_id: request.params.businessId, provider, display_name: displayName, endpoint_url: String(body.endpoint_url).trim(), active: body.active === false ? 0 : 1 } });
  });

  app.patch("/api/v1/businesses/:businessId/payment-terminals/:id", async (request, reply) => {
    if (!(await requireRole(request, reply))) return;
    const body = request.body;
    if (!isObject(body)) return reply.badRequest("Terminal update must be an object");
    if (body.display_name !== undefined && (typeof body.display_name !== "string" || !body.display_name.trim() || body.display_name.trim().length > 120)) return reply.badRequest("Invalid terminal name");
    if (body.endpoint_url !== undefined && !isValidEndpoint(body.endpoint_url)) return reply.badRequest("Invalid terminal endpoint");
    if (body.active !== undefined && ![true, false, 1, 0].includes(body.active)) return reply.badRequest("Invalid active flag");
    const [result] = await pool.query(
      "UPDATE payment_terminals SET display_name = COALESCE(?, display_name), endpoint_url = COALESCE(?, endpoint_url), active = COALESCE(?, active), updated_at = CURRENT_TIMESTAMP WHERE id = ? AND business_id = ?",
      [
        body.display_name === undefined ? null : body.display_name.trim(),
        body.endpoint_url === undefined ? null : String(body.endpoint_url).trim(),
        body.active === undefined ? null : body.active ? 1 : 0,
        request.params.id,
        request.params.businessId,
      ],
    );
    if (!result.affectedRows) return reply.notFound("Terminal not found");
    if (body.access_token !== undefined) {
      if (!hasSecretKey()) return reply.code(503).send({ error: "FOOD_SYSTEM_SECRET_KEY is not configured" });
      const token = String(body.access_token);
      if (token && (token.length < 8 || token.length > 4096)) return reply.badRequest("access_token must contain 8 to 4096 characters");
      if (token) await writeSecret(request.params.businessId, `payment:terminal:${request.params.id}`, { access_token: token });
      else await pool.query("DELETE FROM secure_secrets WHERE business_id = ? AND secret_name = ?", [request.params.businessId, `payment:terminal:${request.params.id}`]);
    }
    await audit(request, request.user, "payment_terminal.updated", "payment_terminal", request.params.id, {});
    return { updated: true };
  });

  app.delete("/api/v1/businesses/:businessId/payment-terminals/:id", async (request, reply) => {
    if (!(await requireRole(request, reply))) return;
    const [result] = await pool.query("DELETE FROM payment_terminals WHERE id = ? AND business_id = ?", [request.params.id, request.params.businessId]);
    if (!result.affectedRows) return reply.notFound("Terminal not found");
    await pool.query("DELETE FROM secure_secrets WHERE business_id = ? AND secret_name = ?", [request.params.businessId, `payment:terminal:${request.params.id}`]);
    await audit(request, request.user, "payment_terminal.deleted", "payment_terminal", request.params.id, {});
    return { removed: true };
  });

  app.post("/api/v1/businesses/:businessId/payment-terminals/:id/charge", async (request, reply) => {
    if (!(await requireRole(request, reply))) return;
    const body = request.body;
    if (!isObject(body)) return reply.badRequest("Charge data must be an object");
    const [terminals] = await pool.query("SELECT * FROM payment_terminals WHERE id = ? AND business_id = ? AND active = 1 LIMIT 1", [request.params.id, request.params.businessId]);
    if (!terminals.length) return reply.notFound("Terminal not found or inactive");
    const order = await findOrder(request.params.businessId, body.order_id);
    if (!order) return reply.notFound("Order not found");
    const amount = Number(body.amount ?? order.total);
    if (!Number.isFinite(amount) || amount <= 0) return reply.badRequest("Invalid charge amount");
    const idempotencyKey = typeof body.idempotency_key === "string" && body.idempotency_key.trim() ? body.idempotency_key.trim() : "";
    if (idempotencyKey) {
      const [existing] = await pool.query(
        "SELECT cp.* FROM card_payments cp WHERE cp.business_id = ? AND cp.external_id = ? AND cp.source_type = 'terminal' LIMIT 1",
        [request.params.businessId, idempotencyKey],
      );
      if (existing.length) return reply.code(202).send({ payment: existing[0], duplicate: true });
    }
    const secret = await readSecret(request.params.businessId, `payment:terminal:${request.params.id}`);
    const headers = secret?.access_token ? { Authorization: `Bearer ${secret.access_token}` } : {};
    const reference = idempotencyKey || randomUUID();
    const payload = buildTerminalCharge(terminals[0].provider, { amount, installments: body.installments, orderId: order.id, reference });
    let response;
    try { response = await postJson(new URL(terminals[0].endpoint_url), payload, headers); }
    catch (error) { return reply.code(502).send({ error: `Terminal request failed: ${String(error.message || error).slice(0, 200)}` }); }
    let normalized;
    try { normalized = normalizeTerminalResponse(terminals[0].provider, response.body, response.status); }
    catch (error) { return reply.code(502).send({ error: String(error.message || error).slice(0, 200) }); }
    const paymentId = randomUUID();
    await pool.query(
      "INSERT INTO card_payments (id, business_id, order_id, source_type, source_id, amount, installments, status, external_id, request_payload, response_payload, error_message, settled_at) VALUES (?, ?, ?, 'terminal', ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        paymentId, request.params.businessId, order.id, request.params.id, amount, payload.installments,
        normalized.status, normalized.external_id || reference, JSON.stringify(payload), JSON.stringify(normalized.raw),
        normalized.status === "error" ? `HTTP ${response.status}` : null,
        normalized.status === "approved" ? new Date().toISOString() : null,
      ],
    );
    if (normalized.status === "approved" && isObject(body.payment_allocation)) {
      const allocation = body.payment_allocation;
      if (typeof allocation.payment_method_id === "string" && Number.isFinite(Number(allocation.amount))) {
        await pool.query(
          "INSERT INTO order_payments (id, business_id, order_id, payment_method_id, amount, card_payment_id) VALUES (?, ?, ?, ?, ?, ?)",
          [randomUUID(), request.params.businessId, order.id, allocation.payment_method_id, Number(allocation.amount).toFixed(2), paymentId],
        );
      }
    }
    await audit(request, request.user, "payment.terminal_charge", "card_payment", paymentId, { status: normalized.status, amount });
    return reply.code(normalized.status === "approved" ? 201 : 202).send({ payment: { id: paymentId, status: normalized.status, amount, installments: payload.installments, external_id: normalized.external_id || reference } });
  });

  app.get("/api/v1/businesses/:businessId/payment-gateways", async (request, reply) => {
    if (!(await requireRole(request, reply))) return;
    const [rows] = await pool.query(
      "SELECT id, business_id, provider, display_name, active, created_at, updated_at FROM payment_gateways WHERE business_id = ? ORDER BY display_name",
      [request.params.businessId],
    );
    return { gateways: rows };
  });

  app.post("/api/v1/businesses/:businessId/payment-gateways", async (request, reply) => {
    if (!(await requireRole(request, reply))) return;
    if (!hasSecretKey()) return reply.code(503).send({ error: "FOOD_SYSTEM_SECRET_KEY is not configured" });
    const body = request.body;
    if (!isObject(body)) return reply.badRequest("Gateway data must be an object");
    const provider = typeof body.provider === "string" ? body.provider : "";
    if (!GATEWAY_PROVIDERS.includes(provider)) return reply.badRequest("Invalid gateway provider");
    const displayName = typeof body.display_name === "string" ? body.display_name.trim() : "";
    if (!displayName || displayName.length > 120) return reply.badRequest("Gateway name must contain 1 to 120 characters");
    if (!isValidCheckoutUrl(body.api_url)) return reply.badRequest("api_url must be a valid HTTP or HTTPS URL");
    const accessToken = String(body.access_token || "");
    if (accessToken.length < 8 || accessToken.length > 4096) return reply.badRequest("access_token must contain 8 to 4096 characters");
    const webhookSecret = String(body.webhook_secret || "");
    if (webhookSecret.length < 16 || webhookSecret.length > 512) return reply.badRequest("webhook_secret must contain 16 to 512 characters");
    const returnUrl = String(body.return_url || "");
    if (returnUrl && !isValidCheckoutUrl(returnUrl)) return reply.badRequest("return_url must be a valid URL");
    const id = randomUUID();
    await pool.query(
      "INSERT INTO payment_gateways (id, business_id, provider, display_name, active) VALUES (?, ?, ?, ?, ?)",
      [id, request.params.businessId, provider, displayName, body.active === false ? 0 : 1],
    );
    await writeSecret(request.params.businessId, `payment:gateway:${id}`, { api_url: String(body.api_url).trim(), access_token: accessToken, webhook_secret: webhookSecret, return_url: returnUrl });
    await audit(request, request.user, "payment_gateway.created", "payment_gateway", id, { provider });
    return reply.code(201).send({ gateway: { id, business_id: request.params.businessId, provider, display_name: displayName, active: body.active === false ? 0 : 1 } });
  });

  app.delete("/api/v1/businesses/:businessId/payment-gateways/:id", async (request, reply) => {
    if (!(await requireRole(request, reply))) return;
    const [result] = await pool.query("DELETE FROM payment_gateways WHERE id = ? AND business_id = ?", [request.params.id, request.params.businessId]);
    if (!result.affectedRows) return reply.notFound("Gateway not found");
    await pool.query("DELETE FROM secure_secrets WHERE business_id = ? AND secret_name = ?", [request.params.businessId, `payment:gateway:${request.params.id}`]);
    await audit(request, request.user, "payment_gateway.deleted", "payment_gateway", request.params.id, {});
    return { removed: true };
  });

  app.post("/api/v1/businesses/:businessId/payment-gateways/:id/checkout", async (request, reply) => {
    if (!(await requireRole(request, reply))) return;
    const body = request.body;
    if (!isObject(body)) return reply.badRequest("Checkout data must be an object");
    const [gateways] = await pool.query("SELECT * FROM payment_gateways WHERE id = ? AND business_id = ? AND active = 1 LIMIT 1", [request.params.id, request.params.businessId]);
    if (!gateways.length) return reply.notFound("Gateway not found or inactive");
    const order = await findOrder(request.params.businessId, body.order_id);
    if (!order) return reply.notFound("Order not found");
    const amount = Number(body.amount ?? order.total);
    if (!Number.isFinite(amount) || amount <= 0) return reply.badRequest("Invalid checkout amount");
    const secret = await readSecret(request.params.businessId, `payment:gateway:${request.params.id}`);
    if (!secret) return reply.code(503).send({ error: "Gateway credentials are unavailable" });
    const payload = buildGatewayCheckout(gateways[0].provider, {
      amount,
      orderId: order.id,
      returnUrl: secret.return_url || undefined,
      description: `Pedido ${order.id}`,
    });
    let response;
    try { response = await postJson(new URL(secret.api_url), payload, { Authorization: `Bearer ${secret.access_token}` }); }
    catch (error) { return reply.code(502).send({ error: `Gateway request failed: ${String(error.message || error).slice(0, 200)}` }); }
    let normalized;
    try { normalized = normalizeGatewayCheckout(gateways[0].provider, response.body, response.status); }
    catch (error) { return reply.code(502).send({ error: String(error.message || error).slice(0, 200) }); }
    const paymentId = randomUUID();
    await pool.query(
      "INSERT INTO card_payments (id, business_id, order_id, source_type, source_id, amount, installments, status, external_id, request_payload, response_payload) VALUES (?, ?, ?, 'gateway', ?, ?, 1, 'pending', ?, ?, ?)",
      [paymentId, request.params.businessId, order.id, request.params.id, amount, normalized.external_id || null, JSON.stringify(payload), JSON.stringify(normalized.raw)],
    );
    await audit(request, request.user, "payment.gateway_checkout", "card_payment", paymentId, { amount });
    return reply.code(201).send({ payment: { id: paymentId, status: "pending", checkout_url: normalized.checkout_url, external_id: normalized.external_id || null } });
  });

  app.get("/api/v1/businesses/:businessId/card-payments", async (request, reply) => {
    if (!(await requireRole(request, reply))) return;
    const [rows] = await pool.query(
      "SELECT id, order_id, source_type, source_id, amount, installments, status, external_id, error_message, created_at, settled_at FROM card_payments WHERE business_id = ? ORDER BY created_at DESC LIMIT 200",
      [request.params.businessId],
    );
    return { payments: rows };
  });

  app.post("/api/v1/businesses/:businessId/payment-gateways/:id/webhook", { bodyLimit: MAX_WEBHOOK_BYTES }, async (request, reply) => {
    const secret = await readSecret(request.params.businessId, `payment:gateway:${request.params.id}`);
    if (!secret?.webhook_secret) return reply.unauthorized("Invalid webhook signature");
    const rawBody = JSON.stringify(request.body || {});
    if (!validWebhookSignature(request, secret.webhook_secret, rawBody)) return reply.unauthorized("Invalid webhook signature");
    const [gateways] = await pool.query("SELECT id FROM payment_gateways WHERE id = ? AND business_id = ? LIMIT 1", [request.params.id, request.params.businessId]);
    if (!gateways.length) return reply.notFound("Gateway not found");
    let normalized;
    try { normalized = normalizeGatewayWebhook(gateways[0].provider, request.body); }
    catch (error) { return reply.badRequest(String(error.message || error).slice(0, 200)); }
    let result;
    if (normalized.external_id) {
      const [rows] = await pool.query(
        "UPDATE card_payments SET status = ?, response_payload = ?, settled_at = CASE WHEN ? = 'approved' THEN CURRENT_TIMESTAMP ELSE settled_at END, error_message = NULL WHERE business_id = ? AND source_type = 'gateway' AND source_id = ? AND external_id = ? AND status = 'pending'",
        [normalized.status, JSON.stringify(normalized.raw), normalized.status, request.params.businessId, request.params.id, normalized.external_id],
      );
      result = rows.affectedRows;
    }
    return { updated: result || 0 };
  });
}
