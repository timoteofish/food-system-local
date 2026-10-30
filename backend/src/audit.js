import { randomUUID } from "node:crypto";
import { pool } from "./db.js";
import { redact } from "./security.js";

export const audit = async (request, user, action, resourceType = null, resourceId = null, metadata = {}) => {
  if (!user) return;
  const auditUserId = user.local ? null : user.id || null;
  await pool.query(
    "INSERT INTO audit_logs (id, business_id, user_id, action, resource_type, resource_id, ip_address, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [randomUUID(), user.business_id || null, auditUserId, action, resourceType, resourceId, request.ip || null, JSON.stringify(redact(metadata))],
  );
  request.auditRecorded = true;
};
