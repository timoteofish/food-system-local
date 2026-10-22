import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requireBusinessAccess } from "./auth.js";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const backupDir = path.resolve(process.env.FOOD_SYSTEM_BACKUP_DIR || path.join(root, "state", "backups"));
const safeName = (name) => /^food-system-[0-9TZ_.-]+\.sql$/.test(String(name || ""));

export default async function backupRoutes(app) {
  app.get("/api/v1/businesses/:businessId/backups", async (request, reply) => {
    if (!(await requireBusinessAccess(request, reply))) return;
    await mkdir(backupDir, { recursive: true });
    const names = (await readdir(backupDir)).filter(safeName);
    const backups = await Promise.all(names.map(async (name) => { const info = await stat(path.join(backupDir, name)); return { name, size: info.size, created_at: info.mtime.toISOString() }; }));
    return { backups: backups.sort((a, b) => b.created_at.localeCompare(a.created_at)) };
  });

  app.post("/api/v1/businesses/:businessId/backups", async (request, reply) => {
    if (!(await requireBusinessAccess(request, reply))) return;
    try {
      const npm = process.platform === "win32" ? "npm.cmd" : "npm";
      const { stdout } = await execFileAsync(npm, ["run", "db:backup"], { cwd: path.join(root, "backend"), windowsHide: true, timeout: 120000 });
      return reply.code(201).send({ created: true, output: stdout.trim() });
    } catch (error) { request.log.error(error); return reply.internalServerError("Backup failed"); }
  });

  app.post("/api/v1/businesses/:businessId/backups/restore", async (request, reply) => {
    if (!(await requireBusinessAccess(request, reply))) return;
    const name = String(request.body?.name || "");
    if (!safeName(name)) return reply.badRequest("Invalid backup name");
    const file = path.resolve(backupDir, name);
    if (path.dirname(file) !== backupDir) return reply.badRequest("Invalid backup path");
    try {
      await stat(file);
      const npm = process.platform === "win32" ? "npm.cmd" : "npm";
      await execFileAsync(npm, ["run", "db:restore", "--", file], { cwd: path.join(root, "backend"), windowsHide: true, timeout: 120000 });
      return { restored: true, name };
    } catch (error) { request.log.error(error); return reply.internalServerError("Restore failed"); }
  });
}
