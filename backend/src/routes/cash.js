import { randomUUID } from "node:crypto";
import { pool } from "../db.js";
import { requireBusinessAccess, requireRole } from "./auth.js";

export default async function cashRoutes(app) {
  app.get("/api/v1/businesses/:businessId/cash_movements", async (request, reply) => {
    if (!(await requireBusinessAccess(request, reply))) return;
    const { params } = request;
    const [movements] = await pool.query("SELECT * FROM cash_movements WHERE business_id = ? ORDER BY created_at DESC", [params.businessId]);
    const [totals] = await pool.query("SELECT COALESCE(SUM(CASE WHEN type IN ('sale','entry') THEN amount ELSE -amount END), 0) AS balance FROM cash_movements WHERE business_id = ?", [params.businessId]);
    return { movements, balance: Number(totals[0].balance) };
  });

  app.post("/api/v1/businesses/:businessId/cash_movements", async (request, reply) => {
    if (!(await requireRole(request, reply, ["owner", "manager", "cashier"]))) return;
    const input = request.body?.cash_movement || request.body || {};
    const type = String(input.type || "entry");
    const amount = Number(input.amount);
    if (!["entry", "withdrawal"].includes(type) || !Number.isFinite(amount) || amount <= 0 || amount > 99999999.99) return reply.badRequest("Invalid cash movement");
    const id = randomUUID();
    const [sessions] = await pool.query("SELECT id FROM cash_register_sessions WHERE business_id = ? AND status = 'open' ORDER BY opened_at DESC LIMIT 1", [request.params.businessId]);
    if (!sessions.length) return reply.conflict("Open a cash register before recording a movement");
    await pool.query("INSERT INTO cash_movements (id, business_id, session_id, type, amount, description) VALUES (?, ?, ?, ?, ?, ?)", [id, request.params.businessId, sessions[0].id, type, amount.toFixed(2), String(input.description || "").slice(0, 255) || null]);
    return reply.code(201).send({ movement: { id, business_id: request.params.businessId, session_id: sessions[0].id, type, amount, description: input.description || null } });
  });
}
