import { randomUUID } from "node:crypto";
import { pool } from "../db.js";

export default async function catalogRoutes(app) {
  app.get("/api/v1/businesses/:businessId/categories", async ({ params }) => {
    const [rows] = await pool.query(
      "SELECT * FROM categories WHERE business_id = ? ORDER BY position, name",
      [params.businessId]
    );
    return { categories: rows };
  });

  app.post("/api/v1/businesses/:businessId/categories", async (request, reply) => {
    const name = String(request.body?.category?.name || request.body?.name || "").trim();
    if (!name) return reply.badRequest("Category name is required");
    const id = randomUUID();
    await pool.query("INSERT INTO categories (id, business_id, name) VALUES (?, ?, ?)", [id, request.params.businessId, name]);
    return reply.code(201).send({ category: { id, business_id: request.params.businessId, name } });
  });

  app.get("/api/v1/businesses/:businessId/products", async ({ params }) => {
    const [rows] = await pool.query(
      "SELECT p.*, c.name AS category_name FROM products p JOIN categories c ON c.id = p.category_id WHERE p.business_id = ? ORDER BY p.position, p.name",
      [params.businessId]
    );
    return { products: rows };
  });

  app.post("/api/v1/businesses/:businessId/products", async (request, reply) => {
    const product = request.body?.product || request.body || {};
    if (!String(product.name || "").trim() || !product.category_id) return reply.badRequest("Product name and category are required");
    const id = randomUUID();
    await pool.query(
      "INSERT INTO products (id, business_id, category_id, name, description, price, image_url) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [id, request.params.businessId, product.category_id, product.name.trim(), product.description || null, Number(product.price || 0), product.image || product.image_url || null]
    );
    return reply.code(201).send({ product: { id, ...product } });
  });
}
