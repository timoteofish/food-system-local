import { randomUUID } from "node:crypto";
import { pool } from "../db.js";
import { authenticate, requireBusinessAccess, requireRole } from "./auth.js";
import { audit } from "../audit.js";
import { hasDecimalScale } from "../numbers.js";

export default async function businessesRoutes(app) {
  app.get("/api/v1/businesses/:id", async (request, reply) => {
    if (!(await requireBusinessAccess(request, reply))) return;
    const [rows] = await pool.query("SELECT * FROM businesses WHERE id = ? LIMIT 1", [request.params.id]);
    if (!rows.length) return reply.notFound("Business not found");
    return { business: rows[0] };
  });

  app.patch("/api/v1/businesses/:id", async (request, reply) => {
    if (!(await requireRole(request, reply))) return;
    const business = request.body?.business || request.body || {};
    const fields = {
      name: business.name,
      description: business.description,
      primary_color: business.primary_color,
      settings: business.settings,
    };
    const updates = Object.entries(fields).filter(([, value]) => value !== undefined);
    if (!updates.length) return reply.badRequest("No business fields provided");
    if (business.settings !== undefined) {
      if (!business.settings || typeof business.settings !== "object" || Array.isArray(business.settings)) return reply.badRequest("Business settings must be an object");
      if (business.settings.delivery_fee !== undefined && (!hasDecimalScale(business.settings.delivery_fee, 2) || Number(business.settings.delivery_fee) < 0 || Number(business.settings.delivery_fee) > 99999999.99)) {
        return reply.badRequest("Delivery fee must be a valid non-negative amount with at most 2 decimal places");
      }
    }

    const setClause = updates.map(([field]) => `${field} = ?`).join(", ");
    const values = updates.map(([field, value]) => field === "settings" ? JSON.stringify(value || {}) : value);
    const [result] = await pool.query(`UPDATE businesses SET ${setClause} WHERE id = ?`, [...values, request.params.id]);
    if (!result.affectedRows) return reply.notFound("Business not found");
    const [rows] = await pool.query("SELECT * FROM businesses WHERE id = ? LIMIT 1", [request.params.id]);
    return { business: rows[0] };
  });

  app.post("/api/v1/businesses", async (request, reply) => {
    const user = await authenticate(request);
    if (!user) return reply.unauthorized("Sessão inválida");
    const { name, description = "", primary_color = "#0f766e" } = request.body || {};
    if (!String(name || "").trim()) return reply.badRequest("Business name is required");

    const id = randomUUID();
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query(
        "INSERT INTO businesses (id, name, description, primary_color, settings) VALUES (?, ?, ?, ?, ?)",
        [id, name.trim(), description, primary_color, JSON.stringify({ currency: "BRL" })]
      );
      await connection.query(
        "INSERT INTO business_memberships (id, user_id, business_id, role) VALUES (?, ?, ?, 'owner')",
        [randomUUID(), user.id, id]
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    await audit(request, user, "business.created", "business", id, { name: name.trim() });
    return reply.code(201).send({ business: { id, name: name.trim(), description, primary_color } });
  });
}
