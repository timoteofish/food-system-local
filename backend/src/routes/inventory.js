import { randomUUID } from "node:crypto";
import { pool } from "../db.js";
import { requireBusinessAccess } from "./auth.js";

const units = new Set(["unit", "g", "kg", "ml", "l"]);
const movementTypes = new Set(["purchase", "adjustment", "loss"]);
const positiveNumber = (value) => Number.isFinite(Number(value)) && Number(value) > 0;

export default async function inventoryRoutes(app) {
  app.get("/api/v1/businesses/:businessId/inventory/items", async (request, reply) => {
    if (!(await requireBusinessAccess(request, reply))) return;
    const [items] = await pool.query("SELECT * FROM inventory_items WHERE business_id = ? ORDER BY name", [request.params.businessId]);
    return { items };
  });

  app.post("/api/v1/businesses/:businessId/inventory/items", async (request, reply) => {
    if (!(await requireBusinessAccess(request, reply))) return;
    const body = request.body || {};
    const name = String(body.name || "").trim();
    const unit = String(body.unit || "unit");
    const currentQuantity = Number(body.current_quantity || 0);
    const minimumQuantity = Number(body.minimum_quantity || 0);
    const costPerUnit = Number(body.cost_per_unit || 0);
    if (!name || name.length > 160 || !units.has(unit) || ![currentQuantity, minimumQuantity, costPerUnit].every(Number.isFinite) || currentQuantity < 0 || minimumQuantity < 0 || costPerUnit < 0) return reply.badRequest("Invalid inventory item");
    const id = randomUUID();
    try {
      await pool.query("INSERT INTO inventory_items (id, business_id, name, unit, current_quantity, minimum_quantity, cost_per_unit) VALUES (?, ?, ?, ?, ?, ?, ?)", [id, request.params.businessId, name, unit, currentQuantity, minimumQuantity, costPerUnit]);
    } catch (error) {
      if (error.code === "ER_DUP_ENTRY") return reply.conflict("Inventory item already exists");
      throw error;
    }
    return reply.code(201).send({ item: { id, business_id: request.params.businessId, name, unit } });
  });

  app.post("/api/v1/businesses/:businessId/inventory/items/:id/movements", async (request, reply) => {
    if (!(await requireBusinessAccess(request, reply))) return;
    const body = request.body || {};
    const type = String(body.type || "");
    const quantity = Number(body.quantity);
    if (!movementTypes.has(type) || !positiveNumber(quantity) || quantity > 999999999) return reply.badRequest("Invalid inventory movement");
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [items] = await connection.query("SELECT id, current_quantity FROM inventory_items WHERE id = ? AND business_id = ? AND active = TRUE FOR UPDATE", [request.params.id, request.params.businessId]);
      if (!items.length) {
        await connection.rollback();
        return reply.notFound("Inventory item not found");
      }
      const delta = type === "purchase" ? quantity : type === "loss" ? -quantity : Number(body.direction) === -1 ? -quantity : quantity;
      if (Number(items[0].current_quantity) + delta < 0) return reply.conflict("Insufficient inventory");
      const movementId = randomUUID();
      await connection.query("UPDATE inventory_items SET current_quantity = current_quantity + ? WHERE id = ?", [delta, request.params.id]);
      await connection.query("INSERT INTO inventory_movements (id, business_id, inventory_item_id, type, quantity, description) VALUES (?, ?, ?, ?, ?, ?)", [movementId, request.params.businessId, request.params.id, type, delta, String(body.description || "").slice(0, 255) || null]);
      await connection.commit();
      return reply.code(201).send({ movement: { id: movementId, item_id: request.params.id, type, quantity: delta } });
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  });

  app.put("/api/v1/businesses/:businessId/products/:productId/recipe", async (request, reply) => {
    if (!(await requireBusinessAccess(request, reply))) return;
    const ingredients = Array.isArray(request.body?.ingredients) ? request.body.ingredients : [];
    if (!ingredients.length) return reply.badRequest("At least one ingredient is required");
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [products] = await connection.query("SELECT id FROM products WHERE id = ? AND business_id = ? LIMIT 1", [request.params.productId, request.params.businessId]);
      if (!products.length) return reply.notFound("Product not found");
      const ids = ingredients.map((entry) => entry.inventory_item_id);
      if (ids.some((id) => !id) || new Set(ids).size !== ids.length || ingredients.some((entry) => !positiveNumber(entry.quantity))) return reply.badRequest("Invalid recipe");
      const [items] = await connection.query(`SELECT id FROM inventory_items WHERE business_id = ? AND active = TRUE AND id IN (${ids.map(() => "?").join(",")})`, [request.params.businessId, ...ids]);
      if (items.length !== ids.length) return reply.badRequest("Recipe contains an invalid inventory item");
      await connection.query("DELETE FROM product_ingredients WHERE product_id = ? AND business_id = ?", [request.params.productId, request.params.businessId]);
      for (const entry of ingredients) await connection.query("INSERT INTO product_ingredients (id, business_id, product_id, inventory_item_id, quantity) VALUES (?, ?, ?, ?, ?)", [randomUUID(), request.params.businessId, request.params.productId, entry.inventory_item_id, Number(entry.quantity)]);
      await connection.commit();
      return { saved: true, ingredients };
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  });
}
