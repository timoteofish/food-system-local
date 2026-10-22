import { randomUUID } from "node:crypto";
import { pool } from "../db.js";
import { requireBusinessAccess } from "./auth.js";

const fiscalView = (row) => ({ ...row, payload: typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload, response_payload: typeof row.response_payload === "string" && row.response_payload ? JSON.parse(row.response_payload) : row.response_payload });

export default async function fiscalRoutes(app) {
  app.get("/api/v1/businesses/:businessId/fiscal/documents", async (request, reply) => {
    if (!(await requireBusinessAccess(request, reply))) return;
    const [rows] = await pool.query("SELECT * FROM fiscal_documents WHERE business_id = ? ORDER BY created_at DESC", [request.params.businessId]);
    return { documents: rows.map(fiscalView) };
  });

  app.post("/api/v1/businesses/:businessId/fiscal/documents", async (request, reply) => {
    if (!(await requireBusinessAccess(request, reply))) return;
    const type = String(request.body?.document_type || "nfce");
    if (!["nfce", "nfe", "receipt"].includes(type)) return reply.badRequest("Invalid fiscal document type");
    const orderId = request.body?.order_id || null;
    if (orderId) {
      const [orders] = await pool.query("SELECT id FROM orders WHERE id = ? AND business_id = ? LIMIT 1", [orderId, request.params.businessId]);
      if (!orders.length) return reply.badRequest("Order does not belong to this business");
    }
    const document = { id: randomUUID(), business_id: request.params.businessId, order_id: orderId, document_type: type, status: "draft", payload: request.body?.payload || {} };
    await pool.query("INSERT INTO fiscal_documents (id, business_id, order_id, document_type, status, payload) VALUES (?, ?, ?, ?, 'draft', ?)", [document.id, document.business_id, document.order_id, document.document_type, JSON.stringify(document.payload)]);
    return reply.code(201).send({ document });
  });

  app.post("/api/v1/businesses/:businessId/fiscal/documents/:id/issue", async (request, reply) => {
    if (!(await requireBusinessAccess(request, reply))) return;
    const provider = process.env.FISCAL_PROVIDER_URL;
    if (!provider) return reply.code(503).send({ error: "Fiscal provider is not configured. Configure FISCAL_PROVIDER_URL and certificate credentials before issuing." });
    await pool.query("UPDATE fiscal_documents SET status = 'pending', provider = ? WHERE id = ? AND business_id = ? AND status = 'draft'", [provider, request.params.id, request.params.businessId]);
    return { document: { id: request.params.id, status: "pending", provider } };
  });
}
