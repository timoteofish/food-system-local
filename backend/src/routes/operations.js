import { createHash, randomUUID } from "node:crypto";
import { pool } from "../db.js";
import { requireBusinessAccess, requireRole } from "./auth.js";
import { hasDecimalScale } from "../numbers.js";

const money = (value) => hasDecimalScale(value, 2) && Number(value) >= 0 && Number(value) <= 99999999.99;
const MAX_CONTACT_NOTES_BYTES = 16 * 1024;
const optionalText = (value, maxLength) => {
  if (value === undefined || value === null || value === "") return { valid: true, value: null };
  if (typeof value !== "string") return { valid: false, value: null };
  const normalized = value.trim();
  return normalized.length <= maxLength ? { valid: true, value: normalized || null } : { valid: false, value: null };
};

export default async function operationsRoutes(app) {
  app.get("/api/v1/businesses/:businessId/payment-methods", async (request, reply) => {
    if (!(await requireBusinessAccess(request, reply))) return;
    const [methods] = await pool.query("SELECT * FROM payment_methods WHERE business_id = ? ORDER BY name", [request.params.businessId]);
    return { methods };
  });

  app.post("/api/v1/businesses/:businessId/payment-methods", async (request, reply) => {
    if (!(await requireRole(request, reply))) return;
    const name = String(request.body?.name || "").trim();
    if (!name || name.length > 80) return reply.badRequest("Invalid payment method");
    const id = randomUUID();
    try { await pool.query("INSERT INTO payment_methods (id, business_id, name) VALUES (?, ?, ?)", [id, request.params.businessId, name]); }
    catch (error) { if (error.code === "ER_DUP_ENTRY") return reply.conflict("Payment method already exists"); throw error; }
    return reply.code(201).send({ method: { id, business_id: request.params.businessId, name, active: 1 } });
  });

  app.get("/api/v1/businesses/:businessId/cash-register/current", async (request, reply) => {
    if (!(await requireBusinessAccess(request, reply))) return;
    const [sessions] = await pool.query("SELECT * FROM cash_register_sessions WHERE business_id = ? AND status = 'open' ORDER BY opened_at DESC LIMIT 1", [request.params.businessId]);
    return { session: sessions[0] || null };
  });

  app.post("/api/v1/businesses/:businessId/cash-register/open", async (request, reply) => {
    if (!(await requireRole(request, reply, ["owner", "manager", "cashier"]))) return;
    const openingAmount = Number(request.body?.opening_amount || 0);
    if (!money(openingAmount)) return reply.badRequest("Invalid opening amount");
    const connection = await pool.getConnection();
    const lockName = `food-system-cash:${createHash("sha256").update(String(request.params.businessId)).digest("hex").slice(0, 40)}`;
    let lockAcquired = false;
    try {
      const [locks] = await connection.query("SELECT GET_LOCK(?, 10) AS acquired", [lockName]);
      lockAcquired = Number(locks[0]?.acquired) === 1;
      if (!lockAcquired) return reply.conflict("Could not reserve this business cash register; try again");
      await connection.beginTransaction();
      const [open] = await connection.query("SELECT id FROM cash_register_sessions WHERE business_id = ? AND status = 'open' FOR UPDATE", [request.params.businessId]);
      if (open.length) { await connection.rollback(); return reply.conflict("A cash register is already open"); }
      const id = randomUUID();
      await connection.query("INSERT INTO cash_register_sessions (id, business_id, opened_by, opening_amount) VALUES (?, ?, ?, ?)", [id, request.params.businessId, request.user?.id || null, openingAmount]);
      await connection.commit();
      return reply.code(201).send({ session: { id, status: "open", opening_amount: openingAmount } });
    } catch (error) { await connection.rollback(); throw error; } finally {
      if (lockAcquired) await connection.query("SELECT RELEASE_LOCK(?)", [lockName]).catch(() => {});
      connection.release();
    }
  });

  app.post("/api/v1/businesses/:businessId/cash-register/:sessionId/close", async (request, reply) => {
    if (!(await requireRole(request, reply, ["owner", "manager", "cashier"]))) return;
    const closingAmount = Number(request.body?.closing_amount);
    if (!money(closingAmount)) return reply.badRequest("Invalid closing amount");
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [sessions] = await connection.query("SELECT opening_amount FROM cash_register_sessions WHERE id = ? AND business_id = ? AND status = 'open' LIMIT 1 FOR UPDATE", [request.params.sessionId, request.params.businessId]);
      if (!sessions.length) { await connection.rollback(); return reply.notFound("Open cash register not found"); }
      const [totals] = await connection.query("SELECT COALESCE(SUM(CASE WHEN type IN ('sale','entry') THEN amount ELSE -amount END), 0) AS movements FROM cash_movements WHERE session_id = ?", [request.params.sessionId]);
      const expectedAmount = Number((Number(sessions[0].opening_amount) + Number(totals[0].movements)).toFixed(2));
      const differenceAmount = Number((closingAmount - expectedAmount).toFixed(2));
      await connection.query("UPDATE cash_register_sessions SET status = 'closed', closing_amount = ?, expected_amount = ?, difference_amount = ?, closed_by = ?, closed_at = CURRENT_TIMESTAMP, notes = ? WHERE id = ? AND business_id = ? AND status = 'open'", [closingAmount, expectedAmount, differenceAmount, request.user?.id || null, String(request.body?.notes || "").slice(0, 255) || null, request.params.sessionId, request.params.businessId]);
      await connection.commit();
      return { closed: true, reconciliation: { expected_amount: expectedAmount, closing_amount: closingAmount, difference_amount: differenceAmount } };
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  });

  for (const resource of ["customers", "suppliers"]) {
    app.get(`/api/v1/businesses/:businessId/${resource}`, async (request, reply) => {
      if (!(await requireBusinessAccess(request, reply))) return;
      const [rows] = await pool.query(`SELECT * FROM ${resource} WHERE business_id = ? ORDER BY name`, [request.params.businessId]);
      return { [resource]: rows };
    });
    app.post(`/api/v1/businesses/:businessId/${resource}`, async (request, reply) => {
      if (!(await requireRole(request, reply))) return;
      const body = request.body?.[resource.slice(0, -1)] || request.body || {};
      if (typeof body.name !== "string") return reply.badRequest("Name is required");
      const name = body.name.trim();
      if (!name || name.length > 160) return reply.badRequest("Name is required");
      const phone = optionalText(body.phone, 40);
      const email = optionalText(body.email, 190);
      const notes = optionalText(body.notes, MAX_CONTACT_NOTES_BYTES);
      const taxId = resource === "suppliers" ? optionalText(body.tax_id, 30) : { valid: true, value: null };
      if (!phone.valid || !email.valid || !notes.valid || !taxId.valid) return reply.badRequest("Contact fields exceed their supported limits or have invalid types");
      if (email.value && !/^\S+@\S+\.\S+$/.test(email.value)) return reply.badRequest("Invalid email address");
      if (notes.value && Buffer.byteLength(notes.value, "utf8") > MAX_CONTACT_NOTES_BYTES) return reply.badRequest("Contact notes exceed the 16 KB storage limit");
      const id = randomUUID();
      const columns = resource === "customers" ? "name, phone, email, notes" : "name, tax_id, phone, email, notes";
      const values = resource === "customers" ? [id, request.params.businessId, name, phone.value, email.value, notes.value] : [id, request.params.businessId, name, taxId.value, phone.value, email.value, notes.value];
      const placeholders = values.map(() => "?").join(", ");
      await pool.query(`INSERT INTO ${resource} (id, business_id, ${columns}) VALUES (${placeholders})`, values);
      return reply.code(201).send({ [resource.slice(0, -1)]: { id, business_id: request.params.businessId, name } });
    });
  }
}
