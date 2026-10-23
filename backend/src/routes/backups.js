import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readdir, stat, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requireRole } from "./auth.js";
import { audit } from "../audit.js";
import { decryptSecret, hasSecretKey } from "../security.js";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const backupDir = path.resolve(process.env.FOOD_SYSTEM_BACKUP_DIR || path.join(root, "state", "backups"));
const safeName = (name) => /^food-system-[0-9TZ_.-]+\.sql\.enc$/.test(String(name || ""));

export default async function backupRoutes(app) {
  app.get("/api/v1/businesses/:businessId/backups", async (request, reply) => {
    if (!(await requireRole(request, reply))) return;
    if (!hasSecretKey()) return reply.code(503).send({ error: "Backup encryption key is not configured" });
    await mkdir(backupDir, { recursive: true });
    const names = (await readdir(backupDir)).filter(safeName);
    const backups = await Promise.all(names.map(async (name) => { const info = await stat(path.join(backupDir, name)); return { name, size: info.size, created_at: info.mtime.toISOString() }; }));
    return { backups: backups.sort((a, b) => b.created_at.localeCompare(a.created_at)) };
  });

  app.post("/api/v1/businesses/:businessId/backups", async (request, reply) => {
    const user = await requireRole(request, reply);
    if (!user) return;
    if (!hasSecretKey()) return reply.code(503).send({ error: "Backup encryption key is not configured" });
    try {
      const npm = process.platform === "win32" ? "npm.cmd" : "npm";
      const { stdout } = await execFileAsync(npm, ["run", "db:backup"], { cwd: path.join(root, "backend"), windowsHide: true, timeout: 120000 });
      await audit(request, user, "backup.created", "backup", null, {});
      return reply.code(201).send({ created: true, output: stdout.trim() });
    } catch (error) { request.log.error(error); return reply.internalServerError("Backup failed"); }
  });

  app.post("/api/v1/businesses/:businessId/backups/restore", async (request, reply) => {
    const user = await requireRole(request, reply);
    if (!user) return;
    const name = String(request.body?.name || "");
    if (!safeName(name)) return reply.badRequest("Invalid backup name");
    const file = path.resolve(backupDir, name);
    if (path.dirname(file) !== backupDir) return reply.badRequest("Invalid backup path");
    let plaintextFile = null;
    try {
      await stat(file);
      const encrypted = await readFile(file, "utf8");
      plaintextFile = path.join(backupDir, `.restore-${process.pid}-${Date.now()}.sql`);
      await writeFile(plaintextFile, decryptSecret(encrypted), { mode: 0o600 });
      const npm = process.platform === "win32" ? "npm.cmd" : "npm";
      await execFileAsync(npm, ["run", "db:restore", "--", plaintextFile], { cwd: path.join(root, "backend"), windowsHide: true, timeout: 120000 });
      await audit(request, user, "backup.restored", "backup", name, {});
      return { restored: true, name };
    } catch (error) { request.log.error(error); return reply.internalServerError("Restore failed"); }
    finally { if (plaintextFile) await rm(plaintextFile, { force: true }); }
  });
}
