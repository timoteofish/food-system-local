import { randomUUID } from "node:crypto";
import { pool } from "../db.js";
import { requireBusinessAccess, requireRole } from "./auth.js";
import { config } from "../config.js";
import { audit } from "../audit.js";

export default async function platformRoutes(app) {
  app.get("/api/v1/businesses/:businessId/system/update", async (request, reply) => {
    if (!(await requireBusinessAccess(request, reply))) return;
    const currentVersion = config.appVersion;
    const availableVersion = config.update.version;
    return {
      current_version: currentVersion,
      available_version: availableVersion,
      update_available: availableVersion !== currentVersion,
      download_url: config.update.url,
      sha256: config.update.sha256 || null,
      signature: config.update.signature || null,
      public_key: config.update.publicKey || null,
      notes: config.update.notes,
    };
  });
  app.get("/api/v1/businesses/:businessId/public", async (request, reply) => {
    const [businesses] = await pool.query("SELECT id, name, description, primary_color, settings FROM businesses WHERE id = ? LIMIT 1", [request.params.businessId]);
    if (!businesses.length) return reply.notFound("Business not found");
    const [categories] = await pool.query("SELECT id, name, description, position FROM categories WHERE business_id = ? AND active = TRUE ORDER BY position, name", [request.params.businessId]);
    const [products] = await pool.query("SELECT id, category_id, name, description, price, image_url, position FROM products WHERE business_id = ? AND active = TRUE ORDER BY position, name", [request.params.businessId]);
    return { business: businesses[0], categories: categories.map((category) => ({ ...category, products: products.filter((product) => product.category_id === category.id).map((product) => ({ ...product, price: Number(product.price) })) })) };
  });

  app.get("/api/v1/businesses/:businessId/team", async (request, reply) => {
    if (!(await requireBusinessAccess(request, reply))) return;
    const [rows] = await pool.query("SELECT m.id, m.role, u.id AS user_id, u.name, u.email FROM business_memberships m JOIN users u ON u.id = m.user_id WHERE m.business_id = ? ORDER BY u.name", [request.params.businessId]);
    return { members: rows.map((row) => ({ id: row.id, role: row.role, status: "active", user: { id: row.user_id, name: row.name, email: row.email } })) };
  });

  app.post("/api/v1/businesses/:businessId/team", async (request, reply) => {
    const user = await requireRole(request, reply);
    if (!user) return;
    const input = request.body?.membership || request.body || {};
    const email = String(input.email || "").trim().toLowerCase();
    const name = String(input.full_name || input.name || "").trim();
    const role = ["owner", "manager", "staff"].includes(input.role) ? input.role : "staff";
    if (!/^\S+@\S+\.\S+$/.test(email) || name.length < 2) return reply.badRequest("Nome e email são obrigatórios");
    const [users] = await pool.query("SELECT id, name, email FROM users WHERE email = ? LIMIT 1", [email]);
    if (!users.length) return reply.badRequest("O usuário precisa se cadastrar antes do convite");
    const [existing] = await pool.query("SELECT id FROM business_memberships WHERE user_id = ? AND business_id = ? LIMIT 1", [users[0].id, request.params.businessId]);
    if (existing.length) return reply.conflict("Usuário já pertence à empresa");
    const id = randomUUID();
    await pool.query("INSERT INTO business_memberships (id, user_id, business_id, role) VALUES (?, ?, ?, ?)", [id, users[0].id, request.params.businessId, role]);
    await audit(request, user, "team.member_added", "membership", id, { role, user_id: users[0].id });
    return reply.code(201).send({ member: { id, role, status: "active", user: users[0] } });
  });

  app.patch("/api/v1/businesses/:businessId/team/:membershipId", async (request, reply) => {
    const user = await requireRole(request, reply);
    if (!user) return;
    const role = String(request.body?.membership?.role || request.body?.role || "");
    if (!["owner", "manager", "staff"].includes(role)) return reply.badRequest("Papel inválido");
    const [result] = await pool.query("UPDATE business_memberships SET role = ? WHERE id = ? AND business_id = ?", [role, request.params.membershipId, request.params.businessId]);
    if (!result.affectedRows) return reply.notFound("Membro não encontrado");
    await audit(request, user, "team.member_role_updated", "membership", request.params.membershipId, { role });
    return { member: { id: request.params.membershipId, role } };
  });

  app.delete("/api/v1/businesses/:businessId/team/:membershipId", async (request, reply) => {
    const user = await requireRole(request, reply);
    if (!user) return;
    const [result] = await pool.query("DELETE FROM business_memberships WHERE id = ? AND business_id = ? AND role <> 'owner'", [request.params.membershipId, request.params.businessId]);
    if (!result.affectedRows) return reply.notFound("Membro não encontrado ou protegido");
    await audit(request, user, "team.member_removed", "membership", request.params.membershipId, {});
    return reply.code(204).send();
  });
}
