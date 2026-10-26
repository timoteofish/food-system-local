import { randomUUID } from "node:crypto";
import https from "node:https";
import { pool } from "../db.js";
import { requireBusinessAccess, requireRole } from "./auth.js";
import { audit } from "../audit.js";
import { decryptSecret, encryptSecret, hasSecretKey } from "../security.js";

const fiscalView = (row) => ({ ...row, payload: typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload, response_payload: typeof row.response_payload === "string" && row.response_payload ? JSON.parse(row.response_payload) : row.response_payload });

const postFiscalDocument = (provider, headers, payload, credentials) => new Promise((resolve, reject) => {
  const target = new URL(provider);
  if (target.protocol !== "https:") return reject(new Error("Fiscal provider must use HTTPS"));
  const request = https.request(target, {
    method: "POST",
    headers,
    cert: credentials.client_cert || undefined,
    key: credentials.client_key || undefined,
    ca: credentials.ca || undefined,
    rejectUnauthorized: true,
    timeout: 15000,
  }, (response) => {
    const chunks = [];
    response.setEncoding("utf8");
    response.on("data", (chunk) => chunks.push(chunk));
    response.on("end", () => resolve({ status: response.statusCode || 0, ok: (response.statusCode || 500) >= 200 && (response.statusCode || 500) < 300, text: chunks.join("") }));
  });
  request.on("timeout", () => request.destroy(new Error("Fiscal provider request timed out")));
  request.on("error", reject);
  request.end(JSON.stringify(payload));
});

export default async function fiscalRoutes(app) {
  app.get("/api/v1/businesses/:businessId/fiscal/documents", async (request, reply) => {
    if (!(await requireBusinessAccess(request, reply))) return;
    const [rows] = await pool.query("SELECT * FROM fiscal_documents WHERE business_id = ? ORDER BY created_at DESC", [request.params.businessId]);
    const [credentials] = await pool.query(
      "SELECT id FROM secure_secrets WHERE business_id = ? AND secret_name = 'fiscal:provider' LIMIT 1",
      [request.params.businessId],
    );
    let providerConfigured = false;
    try {
      providerConfigured = new URL(String(process.env.FISCAL_PROVIDER_URL || "")).protocol === "https:";
    } catch {
      providerConfigured = false;
    }
    return {
      documents: rows.map(fiscalView),
      configuration: {
        providerConfigured,
        secureStorageAvailable: hasSecretKey(),
        credentialsStored: credentials.length > 0,
      },
    };
  });

  app.post("/api/v1/businesses/:businessId/fiscal/documents", async (request, reply) => {
    const user = await requireRole(request, reply);
    if (!user) return;
    const type = String(request.body?.document_type || "nfce");
    if (!["nfce", "nfe", "receipt"].includes(type)) return reply.badRequest("Invalid fiscal document type");
    const orderId = request.body?.order_id || null;
    if (orderId) {
      const [orders] = await pool.query("SELECT id FROM orders WHERE id = ? AND business_id = ? LIMIT 1", [orderId, request.params.businessId]);
      if (!orders.length) return reply.badRequest("Order does not belong to this business");
    }
    const document = { id: randomUUID(), business_id: request.params.businessId, order_id: orderId, document_type: type, status: "draft", payload: request.body?.payload || {} };
    await pool.query("INSERT INTO fiscal_documents (id, business_id, order_id, document_type, status, payload) VALUES (?, ?, ?, ?, 'draft', ?)", [document.id, document.business_id, document.order_id, document.document_type, JSON.stringify(document.payload)]);
    await audit(request, user, "fiscal.document_created", "fiscal_document", document.id, { document_type: type, order_id: orderId });
    return reply.code(201).send({ document });
  });

  app.put("/api/v1/businesses/:businessId/fiscal/credentials", async (request, reply) => {
    const user = await requireRole(request, reply);
    if (!user) return;
    if (!hasSecretKey()) return reply.code(503).send({ error: "FOOD_SYSTEM_SECRET_KEY is not configured" });
    const submitted = request.body?.credentials;
    if (!submitted || typeof submitted !== "object" || Array.isArray(submitted)) return reply.badRequest("Fiscal credentials are required");
    const allowedFields = new Set(["api_token", "client_cert", "client_key", "ca"]);
    const updates = {};
    for (const [field, value] of Object.entries(submitted)) {
      if (!allowedFields.has(field) || typeof value !== "string") return reply.badRequest("Invalid fiscal credential field");
      if (value.trim()) updates[field] = value.trim();
    }
    if (!Object.keys(updates).length) return reply.badRequest("Enter at least one fiscal credential");

    const [existing] = await pool.query(
      "SELECT encrypted_value FROM secure_secrets WHERE business_id = ? AND secret_name = 'fiscal:provider' LIMIT 1",
      [request.params.businessId],
    );
    let current = {};
    if (existing.length) {
      try {
        current = JSON.parse(decryptSecret(existing[0].encrypted_value));
        if (!current || typeof current !== "object" || Array.isArray(current)) current = {};
      } catch {
        return reply.code(503).send({ error: "Existing fiscal credentials could not be read" });
      }
    }
    const credentials = { ...current, ...updates };
    await pool.query(
      "INSERT INTO secure_secrets (id, business_id, secret_name, encrypted_value) VALUES (?, ?, 'fiscal:provider', ?) ON DUPLICATE KEY UPDATE encrypted_value = VALUES(encrypted_value), updated_at = CURRENT_TIMESTAMP",
      [randomUUID(), request.params.businessId, encryptSecret(JSON.stringify(credentials))],
    );
    await audit(request, user, "fiscal.credentials_updated", "fiscal", request.params.businessId, { fields: Object.keys(updates) });
    return { stored: true };
  });

  app.post("/api/v1/businesses/:businessId/fiscal/documents/:id/issue", async (request, reply) => {
    const user = await requireRole(request, reply);
    if (!user) return;
    const provider = process.env.FISCAL_PROVIDER_URL;
    if (!provider || !/^https:\/\//i.test(provider)) return reply.code(503).send({ error: "Fiscal provider is not configured with HTTPS. Configure FISCAL_PROVIDER_URL and certificate credentials before issuing." });
    if (!hasSecretKey()) return reply.code(503).send({ error: "FOOD_SYSTEM_SECRET_KEY is not configured" });
    const [documents] = await pool.query("SELECT id, document_type, payload FROM fiscal_documents WHERE id = ? AND business_id = ? AND status = 'draft' LIMIT 1", [request.params.id, request.params.businessId]);
    if (!documents.length) return reply.notFound("Draft fiscal document not found");
    const [secrets] = await pool.query("SELECT encrypted_value FROM secure_secrets WHERE business_id = ? AND secret_name = 'fiscal:provider' LIMIT 1", [request.params.businessId]);
    if (!secrets.length) return reply.code(503).send({ error: "Fiscal provider credentials are not configured" });
    let credentials;
    try { credentials = JSON.parse(decryptSecret(secrets[0].encrypted_value)); } catch { return reply.code(503).send({ error: "Fiscal provider credentials are invalid" }); }
    const headers = { "Content-Type": "application/json", Accept: "application/json" };
    if (credentials.api_token) headers.Authorization = `Bearer ${credentials.api_token}`;
    const payload = typeof documents[0].payload === "string" ? JSON.parse(documents[0].payload) : documents[0].payload;
    await pool.query("UPDATE fiscal_documents SET status = 'pending', provider = ?, error_message = NULL WHERE id = ? AND business_id = ? AND status = 'draft'", [provider, request.params.id, request.params.businessId]);
    try {
      const response = await postFiscalDocument(provider, headers, { document_type: documents[0].document_type, document: payload }, credentials);
      const responseText = response.text;
      let responsePayload; try { responsePayload = responseText ? JSON.parse(responseText) : {}; } catch { responsePayload = { raw: responseText.slice(0, 5000) }; }
      const authorized = response.ok && responsePayload.status !== "rejected";
      await pool.query("UPDATE fiscal_documents SET status = ?, response_payload = ?, number = ?, access_key = ?, error_message = ? WHERE id = ? AND business_id = ?", [authorized ? "authorized" : "rejected", JSON.stringify(responsePayload), responsePayload.number || null, responsePayload.access_key || null, authorized ? null : String(responsePayload.error || responsePayload.message || `Provider returned HTTP ${response.status}`).slice(0, 500), request.params.id, request.params.businessId]);
      await audit(request, user, authorized ? "fiscal.document_authorized" : "fiscal.document_rejected", "fiscal_document", request.params.id, { provider, http_status: response.status });
      return { document: { id: request.params.id, status: authorized ? "authorized" : "rejected", provider, response: responsePayload } };
    } catch (error) {
      await pool.query("UPDATE fiscal_documents SET status = 'rejected', error_message = ? WHERE id = ? AND business_id = ?", [String(error.message || "Fiscal provider request failed").slice(0, 500), request.params.id, request.params.businessId]);
      await audit(request, user, "fiscal.document_failed", "fiscal_document", request.params.id, { provider });
      return reply.code(502).send({ error: "Fiscal provider request failed" });
    }
  });
}
