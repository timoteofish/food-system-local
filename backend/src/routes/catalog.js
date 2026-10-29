import { randomUUID } from "node:crypto";
import { pool } from "../db.js";
import { requireBusinessAccess, requireRole } from "./auth.js";
import { hasDecimalScale } from "../numbers.js";

const MAX_TEXT_BYTES = 65_535;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const isBoolean = (value) => value === true || value === false || value === 0 || value === 1;
const isPosition = (value) => Number.isInteger(value) && value >= -2_147_483_648 && value <= 2_147_483_647;
const isText = (value, maxBytes = MAX_TEXT_BYTES) => typeof value === "string" && Buffer.byteLength(value, "utf8") <= maxBytes;

export default async function catalogRoutes(app) {
  app.get("/api/v1/businesses/:businessId/categories", async (request, reply) => {
    if (!(await requireBusinessAccess(request, reply))) return;
    const { params } = request;
    const [rows] = await pool.query(
      "SELECT * FROM categories WHERE business_id = ? ORDER BY position, name",
      [params.businessId]
    );
    return { categories: rows };
  });

  app.post("/api/v1/businesses/:businessId/categories", async (request, reply) => {
    if (!(await requireRole(request, reply))) return;
    const name = String(request.body?.category?.name || request.body?.name || "").trim();
    if (!name) return reply.badRequest("Category name is required");
    if (name.length > 120) return reply.badRequest("Category name must be at most 120 characters");
    const id = randomUUID();
    await pool.query("INSERT INTO categories (id, business_id, name) VALUES (?, ?, ?)", [id, request.params.businessId, name]);
    return reply.code(201).send({ category: { id, business_id: request.params.businessId, name } });
  });

  app.patch("/api/v1/businesses/:businessId/categories/:id", async (request, reply) => {
    if (!(await requireRole(request, reply))) return;
    const category = request.body?.category || request.body || {};
    const updates = Object.entries({ name: category.name, description: category.description, position: category.position, active: category.active })
      .filter(([, value]) => value !== undefined);
    if (!updates.length) return reply.badRequest("No category fields provided");
    for (const [field, value] of updates) {
      if (field === "name" && (typeof value !== "string" || !value.trim() || value.trim().length > 120)) return reply.badRequest("Category name must be between 1 and 120 characters");
      if (field === "description" && value !== null && !isText(value)) return reply.badRequest("Category description is invalid or too long");
      if (field === "position" && !isPosition(value)) return reply.badRequest("Category position must be a 32-bit integer");
      if (field === "active" && !isBoolean(value)) return reply.badRequest("Category active must be a boolean");
    }
    const normalized = updates.map(([field, value]) => [field, field === "name" ? value.trim() : value]);
    const setClause = normalized.map(([field]) => `${field} = ?`).join(", ");
    await pool.query(
      `UPDATE categories SET ${setClause} WHERE id = ? AND business_id = ?`,
      [...normalized.map(([, value]) => value), request.params.id, request.params.businessId]
    );
    const [rows] = await pool.query("SELECT * FROM categories WHERE id = ? AND business_id = ? LIMIT 1", [request.params.id, request.params.businessId]);
    if (!rows.length) return reply.notFound("Category not found");
    return { category: rows[0] };
  });

  app.delete("/api/v1/businesses/:businessId/categories/:id", async (request, reply) => {
    if (!(await requireRole(request, reply))) return;
    const [result] = await pool.query("DELETE FROM categories WHERE id = ? AND business_id = ?", [request.params.id, request.params.businessId]);
    if (!result.affectedRows) return reply.notFound("Category not found");
    return reply.code(204).send();
  });

  app.get("/api/v1/businesses/:businessId/products", async (request, reply) => {
    if (!(await requireBusinessAccess(request, reply))) return;
    const { params } = request;
    const [rows] = await pool.query(
      "SELECT p.*, c.name AS category_name FROM products p JOIN categories c ON c.id = p.category_id AND c.business_id = p.business_id WHERE p.business_id = ? ORDER BY p.position, p.name",
      [params.businessId]
    );
    return { products: rows };
  });

  app.post("/api/v1/businesses/:businessId/products", async (request, reply) => {
    if (!(await requireRole(request, reply))) return;
    const product = request.body?.product || request.body || {};
    const name = typeof product.name === "string" ? product.name.trim() : "";
    const price = Number(product.price);
    if (!name || name.length > 160 || !(product.category_id || product.category)) return reply.badRequest("Product name and category are required");
    if (!hasDecimalScale(product.price, 2) || price < 0 || price > 99999999.99) return reply.badRequest("Product price must be a valid non-negative amount with at most 2 decimal places");
    if (product.category_id !== undefined && (typeof product.category_id !== "string" || !product.category_id)) return reply.badRequest("Product category is invalid");
    if (product.category !== undefined && product.category_id === undefined && (typeof product.category !== "string" || !product.category.trim())) return reply.badRequest("Product category is invalid");
    if (product.kitchen_station_id !== undefined && product.kitchen_station_id !== null && typeof product.kitchen_station_id !== "string") return reply.badRequest("Kitchen station is invalid");
    if (product.description !== undefined && product.description !== null && !isText(product.description)) return reply.badRequest("Product description is invalid or too long");
    const image = product.image ?? product.image_url ?? null;
    if (image !== null && !isText(image, MAX_IMAGE_BYTES)) return reply.badRequest("Product image is invalid or too large");
    let categoryId = product.category_id;
    if (!categoryId) {
      const [categories] = await pool.query("SELECT id FROM categories WHERE business_id = ? AND name = ? LIMIT 1", [request.params.businessId, product.category]);
      categoryId = categories[0]?.id;
    } else {
      const [categories] = await pool.query("SELECT id FROM categories WHERE id = ? AND business_id = ? LIMIT 1", [categoryId, request.params.businessId]);
      if (!categories.length) return reply.badRequest("Category not found");
    }
    if (!categoryId) return reply.badRequest("Category not found");
    if (product.kitchen_station_id) {
      const [stations] = await pool.query("SELECT id FROM kitchen_stations WHERE id = ? AND business_id = ? AND active = TRUE LIMIT 1", [product.kitchen_station_id, request.params.businessId]);
      if (!stations.length) return reply.badRequest("Kitchen station not found");
    }
    const id = randomUUID();
    await pool.query(
      "INSERT INTO products (id, business_id, category_id, kitchen_station_id, name, description, price, image_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [id, request.params.businessId, categoryId, product.kitchen_station_id || null, name, product.description || null, price, image]
    );
    return reply.code(201).send({ product: { id, ...product, category_id: categoryId } });
  });

  app.patch("/api/v1/businesses/:businessId/products/:id", async (request, reply) => {
    if (!(await requireRole(request, reply))) return;
    const product = request.body?.product || request.body || {};
    const image = product.image_url !== undefined ? product.image_url : product.image;
    const fields = { name: product.name, description: product.description, price: product.price, category_id: product.category_id, kitchen_station_id: product.kitchen_station_id, image_url: image, position: product.position, active: product.active };
    const updates = Object.entries(fields).filter(([, value]) => value !== undefined);
    if (!updates.length) return reply.badRequest("No product fields provided");
    for (const [field, value] of updates) {
      if (field === "name" && (typeof value !== "string" || !value.trim() || value.trim().length > 160)) return reply.badRequest("Product name must be between 1 and 160 characters");
      if (field === "description" && value !== null && !isText(value)) return reply.badRequest("Product description is invalid or too long");
      if (field === "price" && (!hasDecimalScale(value, 2) || Number(value) < 0 || Number(value) > 99999999.99)) return reply.badRequest("Product price must be a valid non-negative amount with at most 2 decimal places");
      if (field === "category_id" && (typeof value !== "string" || !value)) return reply.badRequest("Product category is required");
      if (field === "kitchen_station_id" && value !== null && typeof value !== "string") return reply.badRequest("Kitchen station is invalid");
      if (field === "image_url" && value !== null && !isText(value, MAX_IMAGE_BYTES)) return reply.badRequest("Product image is invalid or too large");
      if (field === "position" && !isPosition(value)) return reply.badRequest("Product position must be a 32-bit integer");
      if (field === "active" && !isBoolean(value)) return reply.badRequest("Product active must be a boolean");
    }
    const categoryId = updates.find(([field]) => field === "category_id")?.[1];
    if (categoryId) {
      const [categories] = await pool.query("SELECT id FROM categories WHERE id = ? AND business_id = ? LIMIT 1", [categoryId, request.params.businessId]);
      if (!categories.length) return reply.badRequest("Category not found");
    }
    const stationId = updates.find(([field]) => field === "kitchen_station_id")?.[1];
    if (stationId) {
      const [stations] = await pool.query("SELECT id FROM kitchen_stations WHERE id = ? AND business_id = ? LIMIT 1", [stationId, request.params.businessId]);
      if (!stations.length) return reply.badRequest("Kitchen station not found");
    }
    const normalized = updates.map(([field, value]) => [field, field === "name" ? value.trim() : field === "price" ? Number(value) : value]);
    const setClause = normalized.map(([field]) => `${field} = ?`).join(", ");
    await pool.query(
      `UPDATE products SET ${setClause} WHERE id = ? AND business_id = ?`,
      [...normalized.map(([, value]) => value), request.params.id, request.params.businessId]
    );
    const [rows] = await pool.query("SELECT * FROM products WHERE id = ? AND business_id = ? LIMIT 1", [request.params.id, request.params.businessId]);
    if (!rows.length) return reply.notFound("Product not found");
    return { product: rows[0] };
  });

  app.delete("/api/v1/businesses/:businessId/products/:id", async (request, reply) => {
    if (!(await requireRole(request, reply))) return;
    const [result] = await pool.query("DELETE FROM products WHERE id = ? AND business_id = ?", [request.params.id, request.params.businessId]);
    if (!result.affectedRows) return reply.notFound("Product not found");
    return reply.code(204).send();
  });
}
