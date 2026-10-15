import { randomUUID } from "node:crypto";
import { pool } from "../db.js";

export default async function businessesRoutes(app) {
  app.get("/api/v1/businesses/:id", async (request, reply) => {
    const [rows] = await pool.query("SELECT * FROM businesses WHERE id = ? LIMIT 1", [request.params.id]);
    if (!rows.length) return reply.notFound("Business not found");
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
