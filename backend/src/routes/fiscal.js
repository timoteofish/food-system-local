import { randomUUID } from "node:crypto";
import { pool } from "../db.js";
import { requireRole } from "./auth.js";
import { audit } from "../audit.js";

const MAX_FISCAL_PAYLOAD_BYTES = 256 * 1024;
const fiscalView = (row) => ({ ...row, payload: typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload, response_payload: typeof row.response_payload === "string" && row.response_payload ? JSON.parse(row.response_payload) : row.response_payload });
const isJsonObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

export default async function fiscalRoutes(app) {
  app.get("/api/v1/businesses/:businessId/fiscal/documents", async (request, reply) => {
    if (!(await requireRole(request, reply))) return;
    const [rows] = await pool.query("SELECT * FROM fiscal_documents WHERE business_id = ? ORDER BY created_at DESC", [request.params.businessId]);
    return {
      documents: rows.map(fiscalView),
      configuration: { issuanceAvailable: false },
    };
  });

  app.post("/api/v1/businesses/:businessId/fiscal/documents", async (request, reply) => {
    const user = await requireRole(request, reply);
    if (!user) return;
    if (!isJsonObject(request.body)) return reply.badRequest("Fiscal document data must be an object");
    const type = request.body.document_type === undefined ? "nfce" : typeof request.body.document_type === "string" ? request.body.document_type : "";
    if (!["nfce", "nfe", "receipt"].includes(type)) return reply.badRequest("Invalid fiscal document type");
    const orderId = request.body?.order_id || null;
    if (orderId !== null && (typeof orderId !== "string" || !orderId || orderId.length > 36)) return reply.badRequest("Invalid order id");
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

  app.post("/api/v1/businesses/:businessId/fiscal/documents/:id/issue", async (request, reply) => {
    if (!(await requireRole(request, reply))) return;
    return reply.code(503).send({ error: "Fiscal issuance is disabled until a certified provider integration and legally complete document payloads are implemented." });
  });
}
