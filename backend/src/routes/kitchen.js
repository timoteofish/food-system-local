import { randomUUID } from "node:crypto";
import { pool } from "../db.js";
import { requireBusinessAccess, requireRole } from "./auth.js";
import { audit } from "../audit.js";

const isSafePrinterUrl = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || (url.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(url.hostname));
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
    const name = String(request.body?.name || "").trim();
    const printerUrl = request.body?.printer_url ? String(request.body.printer_url).trim() : null;
    if (!name || name.length > 120) return reply.badRequest("Station name is required");
    if (printerUrl && !isSafePrinterUrl(printerUrl)) return reply.badRequest("Printer URL must use HTTPS or loopback HTTP");
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
    if (fields.printer_url && !isSafePrinterUrl(String(fields.printer_url))) return reply.badRequest("Printer URL must use HTTPS or loopback HTTP");
    const setClause = updates.map(([field]) => `${field} = ?`).join(", ");
    const [result] = await pool.query(`UPDATE kitchen_stations SET ${setClause} WHERE id = ? AND business_id = ?`, [...updates.map(([, value]) => value), request.params.id, request.params.businessId]);
    if (!result.affectedRows) return reply.notFound("Kitchen station not found");
    await audit(request, user, "kitchen_station.updated", "kitchen_station", request.params.id, { fields: updates.map(([field]) => field) });
    return { updated: true };
  });
}
