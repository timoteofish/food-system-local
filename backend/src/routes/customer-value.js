import { randomUUID } from "node:crypto";
import { pool } from "../db.js";
import { requireBusinessAccess, requireRole } from "./auth.js";
import { hasDecimalScale } from "../numbers.js";

const isMoney = (value) => Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 99999999.99;
const MAX_LOYALTY_POINTS_PER_OPERATION = 1_000_000;
const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

export default async function customerValueRoutes(app) {
  app.get("/api/v1/businesses/:businessId/discounts", async (request, reply) => {
    if (!(await requireBusinessAccess(request, reply))) return;
    const [discounts] = await pool.query("SELECT * FROM discounts WHERE business_id = ? ORDER BY name", [request.params.businessId]);
    return { discounts };
  });

  app.post("/api/v1/businesses/:businessId/discounts", async (request, reply) => {
    if (!(await requireRole(request, reply))) return;
    const body = isPlainObject(request.body) && request.body.discount !== undefined ? request.body.discount : request.body;
    if (!isPlainObject(body)) return reply.badRequest("Discount data must be an object");
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const type = typeof body.type === "string" ? body.type : "";
    const value = Number(body.value);
    const code = body.code === undefined || body.code === null || body.code === "" ? null : typeof body.code === "string" ? body.code.trim().toUpperCase() : false;
    if (!name || name.length > 120 || !["percentage", "fixed"].includes(type) || !hasDecimalScale(body.value, 2) || !isMoney(value) || (type === "percentage" && value > 100) || code === false || (code !== null && (!code || code.length > 40))) return reply.badRequest("Invalid discount");
    const startsAt = body.starts_at === undefined || body.starts_at === null || body.starts_at === "" ? null : body.starts_at;
    const endsAt = body.ends_at === undefined || body.ends_at === null || body.ends_at === "" ? null : body.ends_at;
    if ((startsAt !== null && (typeof startsAt !== "string" || Number.isNaN(Date.parse(startsAt)))) || (endsAt !== null && (typeof endsAt !== "string" || Number.isNaN(Date.parse(endsAt))))) return reply.badRequest("Invalid discount date");
    const id = randomUUID();
    try { await pool.query("INSERT INTO discounts (id, business_id, name, code, type, value, starts_at, ends_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [id, request.params.businessId, name, code, type, value, startsAt, endsAt]); }
    catch (error) { if (error.code === "ER_DUP_ENTRY") return reply.conflict("Discount code already exists"); throw error; }
    return reply.code(201).send({ discount: { id, business_id: request.params.businessId, name, type, value } });
  });

  app.post("/api/v1/businesses/:businessId/discounts/preview", async (request, reply) => {
    if (!(await requireBusinessAccess(request, reply))) return;
    if (!isPlainObject(request.body) || typeof request.body.code !== "string") return reply.badRequest("Code and subtotal are required");
    const code = request.body.code.trim().toUpperCase();
    const subtotal = Number(request.body.subtotal);
    if (!code || code.length > 40 || !hasDecimalScale(request.body.subtotal, 2) || !isMoney(subtotal)) return reply.badRequest("Code and subtotal are required");
    const [rows] = await pool.query("SELECT * FROM discounts WHERE business_id = ? AND code = ? AND active = TRUE AND (starts_at IS NULL OR starts_at <= NOW()) AND (ends_at IS NULL OR ends_at >= NOW()) LIMIT 1", [request.params.businessId, code]);
    if (!rows.length) return reply.notFound("Discount not found");
    const discount = rows[0];
    const amount = Math.min(subtotal, discount.type === "percentage" ? subtotal * Number(discount.value) / 100 : Number(discount.value));
    return { discount: { id: discount.id, name: discount.name, amount: Number(amount.toFixed(2)), total: Number((subtotal - amount).toFixed(2)) } };
  });

  app.get("/api/v1/businesses/:businessId/customers/:customerId/loyalty", async (request, reply) => {
    if (!(await requireBusinessAccess(request, reply))) return;
    const [rows] = await pool.query("SELECT la.*, c.name AS customer_name FROM loyalty_accounts la JOIN customers c ON c.id = la.customer_id WHERE la.business_id = ? AND la.customer_id = ? LIMIT 1", [request.params.businessId, request.params.customerId]);
    return { account: rows[0] || { customer_id: request.params.customerId, points: 0 } };
  });

  app.post("/api/v1/businesses/:businessId/customers/:customerId/loyalty/earn", async (request, reply) => {
    if (!(await requireBusinessAccess(request, reply))) return;
    const points = request.body?.points;
    if (!Number.isInteger(points) || points <= 0 || points > MAX_LOYALTY_POINTS_PER_OPERATION) return reply.badRequest("Invalid points amount");
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [customer] = await connection.query("SELECT id FROM customers WHERE id = ? AND business_id = ? LIMIT 1", [request.params.customerId, request.params.businessId]);
      if (!customer.length) { await connection.rollback(); return reply.notFound("Customer not found"); }
      await connection.query("INSERT INTO loyalty_accounts (id, business_id, customer_id, points) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE points = points + VALUES(points)", [randomUUID(), request.params.businessId, request.params.customerId, points]);
      const [account] = await connection.query("SELECT points FROM loyalty_accounts WHERE business_id = ? AND customer_id = ? LIMIT 1", [request.params.businessId, request.params.customerId]);
      await connection.commit();
      return { points: account[0].points };
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  });

  app.post("/api/v1/businesses/:businessId/customers/:customerId/loyalty/redeem", async (request, reply) => {
    if (!(await requireBusinessAccess(request, reply))) return;
    const points = request.body?.points;
    if (!Number.isInteger(points) || points <= 0 || points > MAX_LOYALTY_POINTS_PER_OPERATION) return reply.badRequest("Invalid points amount");
    const [result] = await pool.query("UPDATE loyalty_accounts SET points = points - ? WHERE business_id = ? AND customer_id = ? AND points >= ?", [points, request.params.businessId, request.params.customerId, points]);
    if (!result.affectedRows) return reply.conflict("Insufficient loyalty points");
    const [account] = await pool.query("SELECT points FROM loyalty_accounts WHERE business_id = ? AND customer_id = ? LIMIT 1", [request.params.businessId, request.params.customerId]);
    return { points: account[0].points };
  });
}
