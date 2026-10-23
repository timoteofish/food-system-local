import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { pool } from "../db.js";
import { config } from "../config.js";

const scrypt = promisify(scryptCallback);
const hashToken = (token) => createHash("sha256").update(token).digest("hex");
const hashPassword = async (password) => {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${Buffer.from(derived).toString("hex")}`;
};
const verifyPassword = async (password, stored) => {
  const [, salt, expectedHex] = String(stored).split(":");
  if (!salt || !expectedHex) return false;
  const actual = Buffer.from(await scrypt(password, salt, 64));
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};
const publicUser = (row) => ({ id: row.id, email: row.email, name: row.name });

export const authenticate = async (request) => {
  const header = String(request.headers.authorization || "");
  if (!header.startsWith("Bearer ")) return null;
  const tokenHash = hashToken(header.slice(7));
  const businessId = request.params?.businessId || request.params?.id || null;
  const membershipFilter = businessId ? " AND m.business_id = ?" : "";
  const values = businessId ? [tokenHash, businessId] : [tokenHash];
  let [rows] = await pool.query(`SELECT u.id, u.email, u.name, m.business_id, m.role FROM sessions s JOIN users u ON u.id = s.user_id JOIN business_memberships m ON m.user_id = u.id WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > NOW()${membershipFilter} LIMIT 1`, values);
  if (!rows[0] && businessId) {
    [rows] = await pool.query("SELECT u.id, u.email, u.name, m.business_id, m.role FROM sessions s JOIN users u ON u.id = s.user_id JOIN business_memberships m ON m.user_id = u.id WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > NOW() LIMIT 1", [tokenHash]);
  }
  if (rows[0]) await pool.query("UPDATE sessions SET last_used_at = NOW() WHERE token_hash = ?", [tokenHash]);
  return rows[0] || null;
};

export const requireBusinessAccess = async (request, reply) => {
  if (config.allowLocalHeader && config.nodeEnv !== "production" && String(request.headers["x-food-system-local"] || "").toLowerCase() === "true") {
    const businessId = request.params.businessId || request.params.id;
    if (businessId) {
      await pool.query(
        "INSERT IGNORE INTO businesses (id, name, description, settings) VALUES (?, ?, ?, ?)",
        [businessId, "Meu estabelecimento", "Aplicação local", JSON.stringify({ currency: "BRL" })],
      );
    }
    const localUser = { id: "local-user", email: "local@food-system.local", name: "Administrador", business_id: businessId, role: "owner", local: true };
    request.user = localUser;
    return localUser;
  }
  const user = await authenticate(request);
  if (!user) {
    reply.unauthorized("Sessão inválida");
    return null;
  }
  if (user.business_id !== request.params.businessId && user.business_id !== request.params.id) {
    reply.forbidden("Acesso negado");
    return null;
  }
  request.user = user;
  return user;
};

export const requireRole = async (request, reply, roles = ["owner", "manager"]) => {
  const user = await requireBusinessAccess(request, reply);
  if (!user) return null;
  if (!user.local && !roles.includes(user.role)) {
    reply.forbidden("Permissão insuficiente");
    return null;
  }
  return user;
};

export default async function authRoutes(app) {
  app.post("/api/v1/auth/register", async (request, reply) => {
    const input = request.body?.user || request.body || {};
    const email = String(input.email || "").trim().toLowerCase();
    const name = String(input.business_name || input.name || "").trim();
    const password = String(input.password || "");
    if (!/^\S+@\S+\.\S+$/.test(email) || name.length < 2 || password.length < 8) return reply.badRequest("Email, nome e senha de 8 caracteres são obrigatórios");
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [existing] = await connection.query("SELECT id FROM users WHERE email = ? LIMIT 1", [email]);
      if (existing.length) return reply.conflict("Email já cadastrado");
      const userId = randomUUID();
      const businessId = randomUUID();
      await connection.query("INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)", [userId, email, name, await hashPassword(password)]);
      await connection.query("INSERT INTO businesses (id, name, description, settings) VALUES (?, ?, ?, ?)", [businessId, name, "", JSON.stringify({ currency: "BRL" })]);
      await connection.query("INSERT INTO business_memberships (id, user_id, business_id, role) VALUES (?, ?, ?, 'owner')", [randomUUID(), userId, businessId]);
      await connection.commit();
      const token = randomBytes(32).toString("base64url");
      await pool.query("INSERT INTO sessions (token_hash, user_id, expires_at, last_used_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? DAY), NOW())", [hashToken(token), userId, config.sessionDays]);
      return reply.code(201).send({ user: { id: userId, email, name }, business: { id: businessId, name }, token });
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  });

  app.post("/api/v1/auth/login", async (request, reply) => {
    const input = request.body?.user || request.body || {};
    const email = String(input.email || "").trim().toLowerCase();
    const [rows] = await pool.query("SELECT * FROM users WHERE email = ? LIMIT 1", [email]);
    if (!rows.length || !(await verifyPassword(String(input.password || ""), rows[0].password_hash))) return reply.unauthorized("Email ou senha inválidos");
    const [memberships] = await pool.query("SELECT b.id, b.name, m.role FROM business_memberships m JOIN businesses b ON b.id = m.business_id WHERE m.user_id = ? LIMIT 1", [rows[0].id]);
    const token = randomBytes(32).toString("base64url");
    await pool.query("UPDATE sessions SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL", [rows[0].id]);
    await pool.query("INSERT INTO sessions (token_hash, user_id, expires_at, last_used_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? DAY), NOW())", [hashToken(token), rows[0].id, config.sessionDays]);
    return { user: publicUser(rows[0]), business: memberships[0] || null, token };
  });

  app.get("/api/v1/auth/profile", async (request, reply) => {
    const user = await authenticate(request);
    if (!user) return reply.unauthorized("Sessão inválida");
    return { user: publicUser(user), business: { id: user.business_id } };
  });

  app.post("/api/v1/auth/logout", async (request) => {
    const header = String(request.headers.authorization || "");
    if (header.startsWith("Bearer ")) await pool.query("DELETE FROM sessions WHERE token_hash = ?", [hashToken(header.slice(7))]);
    return { ok: true };
  });
}
