// Local, per-store polling configuration for delivery providers.
// Each installation is one restaurant. Credentials belong to that store owner
// and are encrypted with the installation key; they never leave this computer.

import { randomUUID } from "node:crypto";
import { pool } from "../db.js";
import { requireRole } from "./auth.js";
import { audit } from "../audit.js";
import { decryptSecret, encryptSecret, hasSecretKey } from "../security.js";
import { resolvePublicHttpsAddress } from "../outbound-request.js";
import { pollIntegrationsOnce } from "../integration-poller.js";

const MAX_CREDENTIALS_BYTES = 32 * 1024;
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const parseSettings = (value) => {
  if (isObject(value)) return value;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return isObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const assertPublicHttpsUrl = (raw) => {
  if (typeof raw !== "string" || !raw.trim()) throw new Error("poll_url is required");
  let url;
  try { url = new URL(raw); }
  catch { throw new Error("poll_url must be a valid HTTPS URL"); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error("poll_url must use HTTPS without credentials or a fragment");
  }
  return url;
};

export default async function integrationPollingRoutes(app) {
  app.put("/api/v1/businesses/:businessId/integrations/:id/polling-credentials", async (request, reply) => {
    const user = await requireRole(request, reply);
    if (!user) return;
    if (!hasSecretKey()) return reply.code(503).send({ error: "FOOD_SYSTEM_SECRET_KEY is not configured" });
    const body = request.body;
    if (!isObject(body)) return reply.badRequest("Polling credentials must be an object");

    let pollUrl;
    try { pollUrl = assertPublicHttpsUrl(body.poll_url); }
    catch (error) { return reply.badRequest(error.message); }

    const token = body.access_token ?? body.api_token;
    if (typeof token !== "string" || token.trim().length < 8 || token.trim().length > 4096) {
      return reply.badRequest("access_token must contain 8 to 4096 characters");
    }
    if (body.token_type !== undefined && !["bearer", "api_key"].includes(body.token_type)) {
      return reply.badRequest("token_type must be bearer or api_key");
    }
    const pollLimit = body.poll_limit === undefined ? 50 : Number(body.poll_limit);
    if (!Number.isInteger(pollLimit) || pollLimit < 1 || pollLimit > 100) {
      return reply.badRequest("poll_limit must be an integer from 1 to 100");
    }

    const [connections] = await pool.query(
      "SELECT id, settings FROM integration_connections WHERE id = ? AND business_id = ? LIMIT 1",
      [request.params.id, request.params.businessId],
    );
    if (!connections.length) return reply.notFound("Integration not found");

    const credentials = {
      access_token: token.trim(),
      token_type: body.token_type || "bearer",
    };
    const serialized = JSON.stringify(credentials);
    if (Buffer.byteLength(serialized, "utf8") > MAX_CREDENTIALS_BYTES) {
      return reply.badRequest("Credentials exceed the 32 KB storage limit");
    }

    await resolvePublicHttpsAddress(pollUrl);

    const settings = parseSettings(connections[0].settings);
    settings.poll_enabled = true;
    settings.poll_url = pollUrl.toString();
    settings.poll_limit = pollLimit;
    if (Buffer.byteLength(JSON.stringify(settings), "utf8") > 32 * 1024) {
      return reply.badRequest("Integration settings exceed the 32 KB storage limit");
    }

    await pool.query(
      "INSERT INTO secure_secrets (id, business_id, secret_name, encrypted_value) VALUES (?, ?, ?, ?) ON CONFLICT(business_id, secret_name) DO UPDATE SET encrypted_value = excluded.encrypted_value, updated_at = CURRENT_TIMESTAMP",
      [randomUUID(), request.params.businessId, `integration:${request.params.id}:oauth`, encryptSecret(serialized)],
    );
    await pool.query(
      "UPDATE integration_connections SET settings = ?, status = CASE WHEN status IN ('disconnected','disabled') THEN 'pending' ELSE status END, last_error = NULL WHERE id = ? AND business_id = ?",
      [JSON.stringify(settings), request.params.id, request.params.businessId],
    );
    await audit(request, user, "integration.polling_credentials_updated", "integration", request.params.id, { poll_url: pollUrl.origin });

    return { stored: true, poll_enabled: true };
  });

  app.delete("/api/v1/businesses/:businessId/integrations/:id/polling-credentials", async (request, reply) => {
    const user = await requireRole(request, reply);
    if (!user) return;
    const [connections] = await pool.query(
      "SELECT id, settings FROM integration_connections WHERE id = ? AND business_id = ? LIMIT 1",
      [request.params.id, request.params.businessId],
    );
    if (!connections.length) return reply.notFound("Integration not found");
    const settings = parseSettings(connections[0].settings);
    delete settings.poll_enabled;
    delete settings.poll_url;
    delete settings.poll_limit;
    await pool.query(
      "DELETE FROM secure_secrets WHERE business_id = ? AND secret_name = ?",
      [request.params.businessId, `integration:${request.params.id}:oauth`],
    );
    await pool.query("UPDATE integration_connections SET settings = ? WHERE id = ? AND business_id = ?", [JSON.stringify(settings), request.params.id, request.params.businessId]);
    await audit(request, user, "integration.polling_credentials_removed", "integration", request.params.id, {});
    return { removed: true };
  });

  app.get("/api/v1/businesses/:businessId/integrations/:id/polling-credentials", async (request, reply) => {
    const user = await requireRole(request, reply);
    if (!user) return;
    const [connections] = await pool.query(
      "SELECT id, provider, settings, last_error, last_checked_at FROM integration_connections WHERE id = ? AND business_id = ? LIMIT 1",
      [request.params.id, request.params.businessId],
    );
    if (!connections.length) return reply.notFound("Integration not found");
    const settings = parseSettings(connections[0].settings);
    const [secrets] = await pool.query(
      "SELECT encrypted_value FROM secure_secrets WHERE business_id = ? AND secret_name = ? LIMIT 1",
      [request.params.businessId, `integration:${request.params.id}:oauth`],
    );
    let hasToken = false;
    if (secrets.length && hasSecretKey()) {
      try { hasToken = Boolean(JSON.parse(decryptSecret(secrets[0].encrypted_value)).access_token); }
      catch { hasToken = false; }
    }
    return {
      polling: {
        provider: connections[0].provider,
        enabled: settings.poll_enabled === true,
        poll_url: settings.poll_url || null,
        poll_limit: settings.poll_limit || null,
        has_token: hasToken,
        last_error: connections[0].last_error,
        last_checked_at: connections[0].last_checked_at,
      },
    };
  });

  app.post("/api/v1/businesses/:businessId/integrations/:id/poll-now", async (request, reply) => {
    const user = await requireRole(request, reply);
    if (!user) return;
    const [connections] = await pool.query(
      "SELECT id, settings FROM integration_connections WHERE id = ? AND business_id = ? LIMIT 1",
      [request.params.id, request.params.businessId],
    );
    if (!connections.length) return reply.notFound("Integration not found");
    const settings = parseSettings(connections[0].settings);
    if (settings.poll_enabled !== true || !settings.poll_url) {
      return reply.badRequest("Polling is not configured for this integration");
    }
    const result = await pollIntegrationsOnce();
    const entry = result.connections?.find((item) => item.connection_id === request.params.id);
    if (!entry) return reply.code(502).send({ error: "Polling could not be completed" });
    await audit(request, user, "integration.polled", "integration", request.params.id, { imported: entry.imported || 0 });
    return { result: entry };
  });
}
