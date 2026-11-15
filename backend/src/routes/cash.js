import { createHash, randomUUID } from "node:crypto";
import { pool } from "../db.js";
import { requireBusinessAccess, requireRole } from "./auth.js";
import { hasDecimalScale } from "../numbers.js";

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

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
    const outer = request.body;
    if (!isPlainObject(outer)) return reply.badRequest("Cash movement data must be an object");
    const input = outer.cash_movement === undefined ? outer : outer.cash_movement;
    if (!isPlainObject(input) || (input.type !== undefined && typeof input.type !== "string") || (input.description !== undefined && input.description !== null && (typeof input.description !== "string" || input.description.length > 255))) return reply.badRequest("Cash movement fields are invalid");
    const type = input.type === undefined ? "entry" : input.type;
    const amount = Number(input.amount);
    if (!["entry", "withdrawal"].includes(type) || !hasDecimalScale(input.amount, 2) || amount <= 0 || amount > 99999999.99) return reply.badRequest("Cash movement amount must be positive and have at most 2 decimal places");
    const key = request.headers["idempotency-key"];
    if (key !== undefined && (typeof key !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(key))) return reply.badRequest("Idempotency-Key must contain 1 to 128 safe characters");
    const description = input.description?.trim() || null;
    const requestHash = key ? createHash("sha256").update(JSON.stringify({ type, amount: amount.toFixed(2), description })).digest("hex") : null;
    const id = randomUUID();
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      if (key) {
        const [previous] = await connection.query("SELECT request_hash, response_json FROM cash_movement_idempotency WHERE business_id = ? AND idempotency_key = ? LIMIT 1", [request.params.businessId, key]);
        if (previous.length) {
          await connection.rollback();
          if (previous[0].request_hash !== requestHash) return reply.conflict("Idempotency key was already used for a different cash movement");
          return reply.code(201).send(JSON.parse(previous[0].response_json));
        }
      }
      const [sessions] = await connection.query("SELECT id FROM cash_register_sessions WHERE business_id = ? AND status = 'open' ORDER BY opened_at DESC LIMIT 1 FOR UPDATE", [request.params.businessId]);
      if (!sessions.length) { await connection.rollback(); return reply.conflict("Open a cash register before recording a movement"); }
      const response = { movement: { id, business_id: request.params.businessId, session_id: sessions[0].id, type, amount, description } };
      await connection.query("INSERT INTO cash_movements (id, business_id, session_id, type, amount, description) VALUES (?, ?, ?, ?, ?, ?)", [id, request.params.businessId, sessions[0].id, type, amount.toFixed(2), description]);
      if (key) await connection.query("INSERT INTO cash_movement_idempotency (business_id, idempotency_key, request_hash, response_json) VALUES (?, ?, ?, ?)", [request.params.businessId, key, requestHash, JSON.stringify(response)]);
      await connection.commit();
      return reply.code(201).send(response);
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  });
}
