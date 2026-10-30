import { randomUUID } from "node:crypto";
import { pool } from "../db.js";
import { requireBusinessAccess, requireRole } from "./auth.js";
import { audit } from "../audit.js";

const isSafePrinterUrl = (value) => {
  if (typeof value !== "string" || value.length > 500) return false;
  try {
    const url = new URL(value);
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    return !url.username && !url.password && (url.protocol === "https:" || (url.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(hostname)));
  } catch { return false; }
};

export default async function kitchenRoutes(app) {
  app.get("/api/v1/businesses/:businessId/kitchen-stations", async (request, reply) => {
    if (!(await requireBusinessAccess(request, reply))) return;
    const [stations] = await pool.query("SELECT id, business_id, name, active, created_at, updated_at FROM kitchen_stations WHERE business_id = ? ORDER BY name", [request.params.businessId]);
    return { stations };
  });

  app.post("/api/v1/businesses/:businessId/kitchen-stations", async (request, reply) => {
    const user = await requireRole(request, reply);
    if (!user) return;
    const rawName = request.body?.name;
    if (typeof rawName !== "string" || !rawName.trim() || rawName.trim().length > 120) return reply.badRequest("Station name must contain 1 to 120 characters");
    const name = rawName.trim();
    const rawPrinterUrl = request.body?.printer_url;
    const printerUrl = rawPrinterUrl === undefined || rawPrinterUrl === null || rawPrinterUrl === "" ? null : typeof rawPrinterUrl === "string" ? rawPrinterUrl.trim() : false;
    if (printerUrl === false || (printerUrl && !isSafePrinterUrl(printerUrl))) return reply.badRequest("Printer URL must be at most 500 characters and use HTTPS or loopback HTTP");
    const id = randomUUID();
    try { await pool.query("INSERT INTO kitchen_stations (id, business_id, name, printer_url) VALUES (?, ?, ?, ?)", [id, request.params.businessId, name, printerUrl]); }
    catch (error) { if (error.code === "ER_DUP_ENTRY") return reply.conflict("Kitchen station already exists"); throw error; }
    await audit(request, user, "kitchen_station.created", "kitchen_station", id, { name });
    return reply.code(201).send({ station: { id, business_id: request.params.businessId, name, printer_url: printerUrl, active: true } });
  });

  app.patch("/api/v1/businesses/:businessId/kitchen-stations/:id", async (request, reply) => {
    const user = await requireRole(request, reply);
    if (!user) return;
    const fields = { name: request.body?.name, active: request.body?.active, printer_url: request.body?.printer_url };
    const updates = Object.entries(fields).filter(([, value]) => value !== undefined);
    if (!updates.length) return reply.badRequest("No station fields provided");
    if (fields.name !== undefined && (typeof fields.name !== "string" || !fields.name.trim() || fields.name.trim().length > 120)) return reply.badRequest("Station name must contain 1 to 120 characters");
    if (fields.active !== undefined && typeof fields.active !== "boolean") return reply.badRequest("Station active value must be a boolean");
    if (fields.printer_url !== undefined && fields.printer_url !== null && fields.printer_url !== "" && (typeof fields.printer_url !== "string" || !isSafePrinterUrl(fields.printer_url.trim()))) return reply.badRequest("Printer URL must be at most 500 characters and use HTTPS or loopback HTTP");
    const setClause = updates.map(([field]) => `${field} = ?`).join(", ");
    const values = updates.map(([field, value]) => field === "name" ? value.trim() : field === "printer_url" && value === "" ? null : value);
    const [result] = await pool.query(`UPDATE kitchen_stations SET ${setClause} WHERE id = ? AND business_id = ?`, [...values, request.params.id, request.params.businessId]);
    if (!result.affectedRows) return reply.notFound("Kitchen station not found");
    await audit(request, user, "kitchen_station.updated", "kitchen_station", request.params.id, { fields: updates.map(([field]) => field) });
    return { updated: true };
  });
}
