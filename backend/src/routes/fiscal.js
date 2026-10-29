import { randomUUID } from "node:crypto";
import https from "node:https";
import { pool } from "../db.js";
import { requireBusinessAccess, requireRole } from "./auth.js";
import { audit } from "../audit.js";
import { decryptSecret, encryptSecret, hasSecretKey } from "../security.js";
import { resolvePublicHttpsAddress } from "../outbound-request.js";

const MAX_FISCAL_PAYLOAD_BYTES = 256 * 1024;
const MAX_FISCAL_CREDENTIAL_BYTES = 32 * 1024;
const fiscalView = (row) => ({ ...row, payload: typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload, response_payload: typeof row.response_payload === "string" && row.response_payload ? JSON.parse(row.response_payload) : row.response_payload });
const isJsonObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const postFiscalDocument = (provider, headers, payload, credentials, resolvedAddress) => new Promise((resolve, reject) => {
  const target = new URL(provider);
  if (target.protocol !== "https:") return reject(new Error("Fiscal provider must use HTTPS"));
  let responseBytes = 0;
  let settled = false;
  let totalTimeout;
  const finish = (error, result) => {
    if (settled) return;
    settled = true;
    clearTimeout(totalTimeout);
    if (error) reject(error);
    else resolve(result);
  };
  const request = https.request(target, {
    method: "POST",
    headers,
    cert: credentials.client_cert || undefined,
    key: credentials.client_key || undefined,
    ca: credentials.ca || undefined,
    rejectUnauthorized: true,
    lookup: (_hostname, _options, callback) => callback(null, resolvedAddress.address, resolvedAddress.family),
    timeout: 15000,
  }, (response) => {
    const chunks = [];
    response.setEncoding("utf8");
    response.on("data", (chunk) => {
      responseBytes += Buffer.byteLength(chunk, "utf8");
      if (responseBytes > 1024 * 1024) request.destroy(new Error("Fiscal provider response exceeded 1 MiB"));
      else chunks.push(chunk);
    });
    response.on("end", () => finish(null, { status: response.statusCode || 0, ok: (response.statusCode || 500) >= 200 && (response.statusCode || 500) < 300, text: chunks.join("") }));
    response.on("aborted", () => finish(new Error("Fiscal provider response was interrupted")));
    response.on("error", (error) => finish(error));
  });
  totalTimeout = setTimeout(() => request.destroy(new Error("Fiscal provider request exceeded 60 seconds")), 60_000);
  request.on("timeout", () => request.destroy(new Error("Fiscal provider request timed out")));
  request.on("error", (error) => finish(error));
  request.end(JSON.stringify(payload));
});

const fiscalProviderTarget = (value) => {
  try {
    const target = new URL(String(value || ""));
    if (target.protocol !== "https:" || !target.hostname || target.username || target.password || target.hostname.length > 80 || (target.port && target.port !== "443")) return null;
    return { url: target.href, label: target.hostname };
  } catch {
    return null;
  }
};

export default async function fiscalRoutes(app) {
  app.get("/api/v1/businesses/:businessId/fiscal/documents", async (request, reply) => {
    if (!(await requireRole(request, reply))) return;
    const [rows] = await pool.query("SELECT * FROM fiscal_documents WHERE business_id = ? ORDER BY created_at DESC", [request.params.businessId]);
    const [credentials] = await pool.query(
      "SELECT id FROM secure_secrets WHERE business_id = ? AND secret_name = 'fiscal:provider' LIMIT 1",
      [request.params.businessId],
    );
    const providerConfigured = Boolean(fiscalProviderTarget(process.env.FISCAL_PROVIDER_URL));
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
    const payload = request.body?.payload === undefined ? {} : request.body.payload;
    if (!isJsonObject(payload) || Buffer.byteLength(JSON.stringify(payload), "utf8") > MAX_FISCAL_PAYLOAD_BYTES) return reply.badRequest("Fiscal document payload must be an object no larger than 256 KB");
    if (orderId) {
      const [orders] = await pool.query("SELECT id FROM orders WHERE id = ? AND business_id = ? LIMIT 1", [orderId, request.params.businessId]);
      if (!orders.length) return reply.badRequest("Order does not belong to this business");
    }
    const document = { id: randomUUID(), business_id: request.params.businessId, order_id: orderId, document_type: type, status: "draft", payload };
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
    if (Buffer.byteLength(JSON.stringify(updates), "utf8") > MAX_FISCAL_CREDENTIAL_BYTES) return reply.badRequest("Fiscal credentials exceed the 32 KB storage limit");

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
    if (Buffer.byteLength(JSON.stringify(credentials), "utf8") > MAX_FISCAL_CREDENTIAL_BYTES) return reply.badRequest("Fiscal credentials exceed the 32 KB storage limit");
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
    const provider = fiscalProviderTarget(process.env.FISCAL_PROVIDER_URL);
    if (!provider) return reply.code(503).send({ error: "Fiscal provider is not configured with HTTPS. Configure FISCAL_PROVIDER_URL and certificate credentials before issuing." });
    if (!hasSecretKey()) return reply.code(503).send({ error: "FOOD_SYSTEM_SECRET_KEY is not configured" });
    const [documents] = await pool.query("SELECT id, document_type, payload FROM fiscal_documents WHERE id = ? AND business_id = ? AND status = 'draft' LIMIT 1", [request.params.id, request.params.businessId]);
    if (!documents.length) return reply.notFound("Draft fiscal document not found");
    const [secrets] = await pool.query("SELECT encrypted_value FROM secure_secrets WHERE business_id = ? AND secret_name = 'fiscal:provider' LIMIT 1", [request.params.businessId]);
    if (!secrets.length) return reply.code(503).send({ error: "Fiscal provider credentials are not configured" });
    let credentials;
    try { credentials = JSON.parse(decryptSecret(secrets[0].encrypted_value)); } catch { return reply.code(503).send({ error: "Fiscal provider credentials are invalid" }); }
    const headers = { "Content-Type": "application/json", Accept: "application/json" };
    if (credentials.api_token) headers.Authorization = `Bearer ${credentials.api_token}`;
    let payload;
    try {
      payload = typeof documents[0].payload === "string" ? JSON.parse(documents[0].payload) : documents[0].payload;
    } catch {
      return reply.code(409).send({ error: "Fiscal document payload is invalid" });
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload) || Object.keys(payload).length === 0) {
      return reply.code(409).send({ error: "Fiscal document payload is empty" });
    }
    const [reservation] = await pool.query("UPDATE fiscal_documents SET status = 'pending', provider = ?, error_message = NULL WHERE id = ? AND business_id = ? AND status = 'draft'", [provider.label, request.params.id, request.params.businessId]);
    if (reservation.affectedRows !== 1) return reply.code(409).send({ error: "Fiscal document is already being processed" });
    let response;
    try {
      const resolvedAddress = await resolvePublicHttpsAddress(new URL(provider.url));
      response = await postFiscalDocument(provider.url, headers, { document_type: documents[0].document_type, document: payload }, credentials, resolvedAddress);
    } catch {
      await pool.query("UPDATE fiscal_documents SET error_message = ? WHERE id = ? AND business_id = ? AND status = 'pending'", ["Provider outcome is unknown; reconcile with the provider before any retry", request.params.id, request.params.businessId]);
      await audit(request, user, "fiscal.document_failed", "fiscal_document", request.params.id, { provider: provider.label });
      return reply.code(502).send({ error: "Fiscal provider request failed" });
    }

    const responseText = response.text;
    let responsePayload;
    try { responsePayload = responseText ? JSON.parse(responseText) : {}; } catch { responsePayload = { raw: responseText.slice(0, 5000) }; }
    if (!responsePayload || typeof responsePayload !== "object" || Array.isArray(responsePayload)) {
      responsePayload = { raw: responseText.slice(0, 5000) };
    }
    const providerStatus = String(responsePayload.status || "").toLowerCase();
    const authorized = response.ok && ["authorized", "issued"].includes(providerStatus);
    const documentNumber = ["string", "number"].includes(typeof responsePayload.number) ? String(responsePayload.number).slice(0, 40) : null;
    const accessKey = ["string", "number"].includes(typeof responsePayload.access_key) ? String(responsePayload.access_key).slice(0, 60) : null;
    const providerError = [responsePayload.error, responsePayload.message].find((value) => typeof value === "string" && value.trim());
    const errorMessage = authorized ? null : String(providerError || `Provider returned HTTP ${response.status} without an explicit authorization status`).slice(0, 500);
    await pool.query("UPDATE fiscal_documents SET status = ?, response_payload = ?, number = ?, access_key = ?, error_message = ? WHERE id = ? AND business_id = ? AND status = 'pending'", [authorized ? "authorized" : "rejected", JSON.stringify(responsePayload), documentNumber, accessKey, errorMessage, request.params.id, request.params.businessId]);
    await audit(request, user, authorized ? "fiscal.document_authorized" : "fiscal.document_rejected", "fiscal_document", request.params.id, { provider: provider.label, http_status: response.status });
    return { document: { id: request.params.id, status: authorized ? "authorized" : "rejected", provider: provider.label, response: responsePayload } };
  });
}
