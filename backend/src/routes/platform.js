import { randomUUID } from "node:crypto";
import { pool } from "../db.js";
import { requireBusinessAccess, requireRole } from "./auth.js";
import { config } from "../config.js";
import { audit } from "../audit.js";
import { createPublicMenu } from "../public-menu.js";

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
      notes: config.update.notes,
    };
  });
  app.get("/api/v1/businesses/:businessId/public", async (request, reply) => {
    const [businesses] = await pool.query("SELECT id, name, description, primary_color, settings FROM businesses WHERE id = ? LIMIT 1", [request.params.businessId]);
    if (!businesses.length) return reply.notFound("Business not found");
    const [categories] = await pool.query("SELECT id, name, description, position FROM categories WHERE business_id = ? AND active = TRUE ORDER BY position, name", [request.params.businessId]);
    const [products] = await pool.query("SELECT id, category_id, name, description, price, image_url, position FROM products WHERE business_id = ? AND active = TRUE ORDER BY position, name", [request.params.businessId]);
    const menuCategories = categories.map((category) => ({
      ...category,
      products: products.filter((product) => product.category_id === category.id),
    }));
    return createPublicMenu(businesses[0], menuCategories);
  });

  app.get("/api/v1/businesses/:businessId/team", async (request, reply) => {
    if (!(await requireRole(request, reply))) return;
    const [rows] = await pool.query("SELECT m.id, m.role, u.id AS user_id, u.name, u.email FROM business_memberships m JOIN users u ON u.id = m.user_id WHERE m.business_id = ? ORDER BY u.name", [request.params.businessId]);
    return { members: rows.map((row) => ({ id: row.id, role: row.role, status: "active", user: { id: row.user_id, name: row.name, email: row.email } })) };
  });

  app.post("/api/v1/businesses/:businessId/team", async (request, reply) => {
    const user = await requireRole(request, reply);
    if (!user) return;
    const input = request.body?.membership || request.body || {};
    const email = String(input.email || "").trim().toLowerCase();
    const name = String(input.full_name || input.name || "").trim();
    const role = input.role === undefined ? "staff" : String(input.role);
    if (!["owner", "manager", "staff"].includes(role)) return reply.badRequest("Invalid team role");
    if (user.role !== "owner" && role !== "staff") return reply.forbidden("Somente um proprietário pode convidar gerentes ou proprietários");
    if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 190 || name.length < 2 || name.length > 160) return reply.badRequest("Name must be 2 to 160 characters and email must be valid and no longer than 190 characters");
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
    if (user.role !== "owner") return reply.forbidden("Somente um proprietário pode alterar funções da equipe");
    const role = String(request.body?.membership?.role || request.body?.role || "");
    if (!["owner", "manager", "staff"].includes(role)) return reply.badRequest("Papel inválido");
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query("SELECT id FROM businesses WHERE id = ? FOR UPDATE", [request.params.businessId]);
      const [members] = await connection.query("SELECT role FROM business_memberships WHERE id = ? AND business_id = ? FOR UPDATE", [request.params.membershipId, request.params.businessId]);
      if (!members.length) { await connection.rollback(); return reply.notFound("Membro não encontrado"); }
      if (members[0].role === "owner" && role !== "owner") {
        const [owners] = await connection.query("SELECT COUNT(*) AS count FROM business_memberships WHERE business_id = ? AND role = 'owner'", [request.params.businessId]);
        if (Number(owners[0].count) <= 1) {
          await connection.rollback();
          return reply.conflict("O estabelecimento precisa manter pelo menos um proprietário");
        }
      }
      await connection.query("UPDATE business_memberships SET role = ? WHERE id = ? AND business_id = ?", [role, request.params.membershipId, request.params.businessId]);
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    await audit(request, user, "team.member_role_updated", "membership", request.params.membershipId, { role });
    return { member: { id: request.params.membershipId, role } };
  });

  app.delete("/api/v1/businesses/:businessId/team/:membershipId", async (request, reply) => {
    const user = await requireRole(request, reply);
    if (!user) return;
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query("SELECT id FROM businesses WHERE id = ? FOR UPDATE", [request.params.businessId]);
      const [members] = await connection.query("SELECT role FROM business_memberships WHERE id = ? AND business_id = ? FOR UPDATE", [request.params.membershipId, request.params.businessId]);
      if (!members.length || members[0].role === "owner") {
        await connection.rollback();
        return reply.notFound("Member not found or protected");
      }
      if (user.role !== "owner" && members[0].role !== "staff") {
        await connection.rollback();
        return reply.forbidden("Managers can remove staff members only");
      }
      await connection.query("DELETE FROM business_memberships WHERE id = ? AND business_id = ? AND role <> 'owner'", [request.params.membershipId, request.params.businessId]);
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    await audit(request, user, "team.member_removed", "membership", request.params.membershipId, {});
    return reply.code(204).send();
  });
}
