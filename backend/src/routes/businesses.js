import { randomUUID } from "node:crypto";
import { pool } from "../db.js";
import { authenticate, requireBusinessAccess, requireRole } from "./auth.js";
import { audit } from "../audit.js";
import { hasDecimalScale } from "../numbers.js";
import { hasValidBusinessColor, hasValidBusinessDescription, hasValidBusinessName } from "../business-validation.js";

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
    const expectedSettings = business.expected_settings;
    const expectedBusiness = business.expected_business;
    if (expectedSettings !== undefined && (typeof expectedSettings !== "string" || Buffer.byteLength(expectedSettings, "utf8") > 32 * 1024 || business.settings === undefined)) return reply.badRequest("Expected business settings are invalid");
    if (expectedBusiness !== undefined && (!expectedBusiness || typeof expectedBusiness !== "object" || Array.isArray(expectedBusiness) || typeof expectedBusiness.name !== "string" || expectedBusiness.name.length > 160 || (expectedBusiness.description !== null && (typeof expectedBusiness.description !== "string" || Buffer.byteLength(expectedBusiness.description, "utf8") > 65535)) || typeof expectedBusiness.primary_color !== "string" || expectedBusiness.primary_color.length > 32)) return reply.badRequest("Expected business data is invalid");
    const fields = {
      name: business.name,
      description: business.description,
      primary_color: business.primary_color,
      settings: business.settings,
      profile_phone: business.profile_phone,
      profile_avatar: business.profile_avatar,
    };
    const updates = Object.entries(fields).filter(([, value]) => value !== undefined);
    if (!updates.length) return reply.badRequest("No business fields provided");
    if (business.name !== undefined && !hasValidBusinessName(business.name)) {
      return reply.badRequest("Business name must be between 2 and 160 characters");
    }
    if (business.description !== undefined && !hasValidBusinessDescription(business.description)) {
      return reply.badRequest("Business description must be text no longer than 65535 bytes");
    }
    if (business.primary_color !== undefined && !hasValidBusinessColor(business.primary_color)) {
      return reply.badRequest("Primary color must be a six-digit hexadecimal color");
    }
    if (business.profile_phone !== undefined && (typeof business.profile_phone !== "string" || business.profile_phone.length > 40)) return reply.badRequest("Profile phone must be text no longer than 40 characters");
    if (business.profile_avatar !== undefined) {
      const avatar = business.profile_avatar;
      if (typeof avatar !== "string" || Buffer.byteLength(avatar, "utf8") > 1024 * 1024) return reply.badRequest("Profile image is invalid or too large");
      if (avatar && !/^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/]+={0,2}$/i.test(avatar)) {
        try { if (!["http:", "https:"].includes(new URL(avatar).protocol)) throw new Error("Invalid protocol"); }
        catch { return reply.badRequest("Profile image must be an image data URL or an HTTP(S) URL"); }
      }
    }
    if (business.settings !== undefined) {
      if (!business.settings || typeof business.settings !== "object" || Array.isArray(business.settings) || Object.getPrototypeOf(business.settings) !== Object.prototype) return reply.badRequest("Business settings must be a plain object");
      if (Buffer.byteLength(JSON.stringify(business.settings), "utf8") > 32 * 1024) return reply.badRequest("Business settings cannot exceed 32 KiB");
      if (business.settings.delivery_fee !== undefined && (!hasDecimalScale(business.settings.delivery_fee, 2) || Number(business.settings.delivery_fee) < 0 || Number(business.settings.delivery_fee) > 99999999.99)) {
        return reply.badRequest("Delivery fee must be a valid non-negative amount with at most 2 decimal places");
      }
    }

    const setClause = updates.map(([field]) => `${field} = ?`).join(", ");
    const values = updates.map(([field, value]) => field === "settings" ? JSON.stringify(value || {}) : field === "name" ? value.trim() : value);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [result] = await connection.query(`UPDATE businesses SET ${setClause} WHERE id = ?${expectedSettings === undefined ? "" : " AND settings = ?"}${expectedBusiness === undefined ? "" : " AND name = ? AND description IS ? AND primary_color = ?"}`, [...values, request.params.id, ...(expectedSettings === undefined ? [] : [expectedSettings]), ...(expectedBusiness === undefined ? [] : [expectedBusiness.name, expectedBusiness.description, expectedBusiness.primary_color])]);
      if (!result.affectedRows) {
        const [current] = await connection.query("SELECT id FROM businesses WHERE id = ? LIMIT 1", [request.params.id]);
        await connection.rollback();
        if (current.length && (expectedSettings !== undefined || expectedBusiness !== undefined)) return reply.conflict("Business settings changed; reload before saving");
        return reply.notFound("Business not found");
      }
      const [rows] = await connection.query("SELECT * FROM businesses WHERE id = ? LIMIT 1", [request.params.id]);
      await connection.commit();
      return { business: rows[0] };
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  });

  app.post("/api/v1/businesses", async (request, reply) => {
    const user = await authenticate(request);
    if (!user) return reply.unauthorized("Invalid session");
    const { name, description = "", primary_color = "#0f766e" } = request.body || {};
    if (!hasValidBusinessName(name)) return reply.badRequest("Business name must be between 2 and 160 characters");
    if (!hasValidBusinessDescription(description)) return reply.badRequest("Business description must be text no longer than 65535 bytes");
    if (!hasValidBusinessColor(primary_color)) return reply.badRequest("Primary color must be a six-digit hexadecimal color");

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
