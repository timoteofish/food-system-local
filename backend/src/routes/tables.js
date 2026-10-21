import { randomBytes, randomUUID } from "node:crypto";
import { pool } from "../db.js";
import { requireBusinessAccess } from "./auth.js";

const tableView = (row) => ({
  id: row.id,
  business_id: row.business_id,
  name: row.name,
  public_token: row.public_token,
  active: Boolean(row.active),
});

export default async function tableRoutes(app) {
  app.get("/api/v1/businesses/:businessId/tables", async (request, reply) => {
    if (!(await requireBusinessAccess(request, reply))) return;
    const { params } = request;
    const [rows] = await pool.query(
      "SELECT id, business_id, name, public_token, active FROM restaurant_tables WHERE business_id = ? ORDER BY name",
      [params.businessId]
    );
    return { tables: rows.map(tableView) };
  });

  app.post("/api/v1/businesses/:businessId/tables", async (request, reply) => {
    if (!(await requireBusinessAccess(request, reply))) return;
    const name = String(request.body?.restaurant_table?.name || request.body?.name || "").trim();
    if (!name || name.length > 120) return reply.badRequest("Table name is required and must be at most 120 characters");
    const table = { id: randomUUID(), business_id: request.params.businessId, name, public_token: randomBytes(24).toString("hex") };
    await pool.query("INSERT INTO restaurant_tables (id, business_id, name, public_token) VALUES (?, ?, ?, ?)", [table.id, table.business_id, table.name, table.public_token]);
    return reply.code(201).send({ table });
  });

  app.post("/api/v1/businesses/:businessId/tables/:id/rotate_token", async (request, reply) => {
    if (!(await requireBusinessAccess(request, reply))) return;
    const token = randomBytes(24).toString("hex");
    const [result] = await pool.query("UPDATE restaurant_tables SET public_token = ? WHERE id = ? AND business_id = ?", [token, request.params.id, request.params.businessId]);
    if (!result.affectedRows) return reply.notFound("Table not found");
    return { table: { id: request.params.id, public_token: token } };
  });

  app.get("/api/v1/menu/:token", async (request, reply) => {
    const [rows] = await pool.query(
      `SELECT b.id AS business_id, b.name AS business_name, b.description AS business_description, b.primary_color,
              t.id AS table_id, t.name AS table_name, c.id AS category_id, c.name AS category_name,
              p.id AS product_id, p.name AS product_name, p.description AS product_description, p.price, p.image_url
       FROM restaurant_tables t JOIN businesses b ON b.id = t.business_id
       LEFT JOIN categories c ON c.business_id = b.id AND c.active = TRUE
       LEFT JOIN products p ON p.category_id = c.id AND p.business_id = b.id AND p.active = TRUE
       WHERE t.public_token = ? AND t.active = TRUE ORDER BY c.position, c.name, p.position, p.name`,
      [request.params.token]
    );
    if (!rows.length) return reply.notFound("Menu table not found");
    const first = rows[0];
    const categories = new Map();
    for (const row of rows) {
      if (!row.category_id) continue;
      if (!categories.has(row.category_id)) categories.set(row.category_id, { id: row.category_id, name: row.category_name, products: [] });
      if (row.product_id) categories.get(row.category_id).products.push({ id: row.product_id, name: row.product_name, description: row.product_description, price: Number(row.price), image_url: row.image_url });
    }
    return { business: { id: first.business_id, name: first.business_name, description: first.business_description, primary_color: first.primary_color }, table: { id: first.table_id, name: first.table_name }, categories: [...categories.values()] };
  });
}
