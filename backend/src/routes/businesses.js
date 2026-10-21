import { randomUUID } from "node:crypto";
import { pool } from "../db.js";
import { requireBusinessAccess } from "./auth.js";

export default async function businessesRoutes(app) {
  app.get("/api/v1/businesses/:id", async (request, reply) => {
    if (!(await requireBusinessAccess(request, reply))) return;
    const [rows] = await pool.query("SELECT * FROM businesses WHERE id = ? LIMIT 1", [request.params.id]);
    if (!rows.length) return reply.notFound("Business not found");
    return { business: rows[0] };
  });

  app.patch("/api/v1/businesses/:id", async (request, reply) => {
    if (!(await requireBusinessAccess(request, reply))) return;
    const business = request.body?.business || request.body || {};
    const fields = {
      name: business.name,
      description: business.description,
      primary_color: business.primary_color,
      settings: business.settings,
    };
    const updates = Object.entries(fields).filter(([, value]) => value !== undefined);
    if (!updates.length) return reply.badRequest("No business fields provided");

    const setClause = updates.map(([field]) => `${field} = ?`).join(", ");
    const values = updates.map(([field, value]) => field === "settings" ? JSON.stringify(value || {}) : value);
    const [result] = await pool.query(`UPDATE businesses SET ${setClause} WHERE id = ?`, [...values, request.params.id]);
    if (!result.affectedRows) return reply.notFound("Business not found");
    const [rows] = await pool.query("SELECT * FROM businesses WHERE id = ? LIMIT 1", [request.params.id]);
    return { business: rows[0] };
  });

  app.post("/api/v1/businesses", async (request, reply) => {
    const { name, description = "", primary_color = "#0f766e" } = request.body || {};
    if (!String(name || "").trim()) return reply.badRequest("Business name is required");

    const id = randomUUID();
    await pool.query(
      "INSERT INTO businesses (id, name, description, primary_color, settings) VALUES (?, ?, ?, ?, ?)",
      [id, name.trim(), description, primary_color, JSON.stringify({ currency: "BRL" })]
    );
    return reply.code(201).send({ business: { id, name: name.trim(), description, primary_color } });
  });
}
