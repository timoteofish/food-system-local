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
    if (name.length > 120) return reply.badRequest("Category name must be at most 120 characters");
    const id = randomUUID();
    await pool.query("INSERT INTO categories (id, business_id, name) VALUES (?, ?, ?)", [id, request.params.businessId, name]);
    return reply.code(201).send({ category: { id, business_id: request.params.businessId, name } });
  });

  app.patch("/api/v1/businesses/:businessId/categories/:id", async (request, reply) => {
    const category = request.body?.category || request.body || {};
    const updates = Object.entries({ name: category.name, description: category.description, position: category.position, active: category.active })
      .filter(([, value]) => value !== undefined);
    if (!updates.length) return reply.badRequest("No category fields provided");
    const setClause = updates.map(([field]) => `${field} = ?`).join(", ");
    const [result] = await pool.query(
      `UPDATE categories SET ${setClause} WHERE id = ? AND business_id = ?`,
      [...updates.map(([, value]) => value), request.params.id, request.params.businessId]
    );
    if (!result.affectedRows) return reply.notFound("Category not found");
    const [rows] = await pool.query("SELECT * FROM categories WHERE id = ? LIMIT 1", [request.params.id]);
    return { category: rows[0] };
  });

  app.delete("/api/v1/businesses/:businessId/categories/:id", async (request, reply) => {
    const [result] = await pool.query("DELETE FROM categories WHERE id = ? AND business_id = ?", [request.params.id, request.params.businessId]);
    if (!result.affectedRows) return reply.notFound("Category not found");
    return reply.code(204).send();
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
    const name = String(product.name || "").trim();
    const price = Number(product.price);
    if (!name || name.length > 160 || !(product.category_id || product.category)) return reply.badRequest("Product name and category are required");
    if (!Number.isFinite(price) || price < 0 || price > 99999999.99) return reply.badRequest("Product price must be a valid non-negative amount");
    let categoryId = product.category_id;
    if (!categoryId) {
      const [categories] = await pool.query("SELECT id FROM categories WHERE business_id = ? AND name = ? LIMIT 1", [request.params.businessId, product.category]);
      categoryId = categories[0]?.id;
    }
    if (!categoryId) return reply.badRequest("Category not found");
    const id = randomUUID();
    await pool.query(
      "INSERT INTO products (id, business_id, category_id, name, description, price, image_url) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [id, request.params.businessId, categoryId, name, product.description || null, price, product.image || product.image_url || null]
    );
    return reply.code(201).send({ product: { id, ...product, category_id: categoryId } });
  });

  app.patch("/api/v1/businesses/:businessId/products/:id", async (request, reply) => {
    const product = request.body?.product || request.body || {};
    const fields = { name: product.name, description: product.description, price: product.price, category_id: product.category_id, image_url: product.image_url || product.image, position: product.position, active: product.active };
    const updates = Object.entries(fields).filter(([, value]) => value !== undefined);
    if (!updates.length) return reply.badRequest("No product fields provided");
    const setClause = updates.map(([field]) => `${field} = ?`).join(", ");
    const [result] = await pool.query(
      `UPDATE products SET ${setClause} WHERE id = ? AND business_id = ?`,
      [...updates.map(([, value]) => value), request.params.id, request.params.businessId]
    );
    if (!result.affectedRows) return reply.notFound("Product not found");
    const [rows] = await pool.query("SELECT * FROM products WHERE id = ? LIMIT 1", [request.params.id]);
    return { product: rows[0] };
  });

  app.delete("/api/v1/businesses/:businessId/products/:id", async (request, reply) => {
    const [result] = await pool.query("DELETE FROM products WHERE id = ? AND business_id = ?", [request.params.id, request.params.businessId]);
    if (!result.affectedRows) return reply.notFound("Product not found");
    return reply.code(204).send();
  });
}
