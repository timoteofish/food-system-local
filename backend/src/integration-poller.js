// Pull-based integration transport for local, single-store installations.
// The store computer asks the provider for new orders using the store owner's
// own credentials. No public port, no middleware, no user accounts required.
// It reuses the encrypted secret store and the idempotent external_orders
// boundary already used by the inbound webhook handler.

import { randomUUID } from "node:crypto";
import { pool } from "./db.js";
import { decryptSecret, hasSecretKey } from "./security.js";
import { requestPublicHttps } from "./outbound-request.js";
import { normalizeOpenDeliveryOrder, normalizeOpenDeliveryStatus } from "./integration-adapters.js";

const MAX_POLL_PAGE_BYTES = 256 * 1024;
const DEFAULT_POLL_INTERVAL_MS = 60_000;

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

const loadCredentials = async (businessId, connectionId) => {
  if (!hasSecretKey()) return null;
  const [secrets] = await pool.query(
    "SELECT encrypted_value FROM secure_secrets WHERE business_id = ? AND secret_name = ? LIMIT 1",
    [businessId, `integration:${connectionId}:oauth`],
  );
  if (!secrets.length) return null;
  try {
    const credentials = JSON.parse(decryptSecret(secrets[0].encrypted_value));
    return isObject(credentials) ? credentials : null;
  } catch {
    return null;
  }
};

const buildRequest = (settings, credentials) => {
  const url = new URL(settings.poll_url);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("Poll URL must be an HTTPS URL without embedded credentials");
  }
  const token = credentials.access_token || credentials.api_token || "";
  if (!token) throw new Error("Stored provider credentials are missing an access token");
  url.searchParams.set("limit", String(Math.min(Math.max(Number(settings.poll_limit) || 50, 1), 100)));
  return { url, token };
};

const extractOrders = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (isObject(payload)) {
    for (const key of ["orders", "data", "results", "items"]) {
      if (Array.isArray(payload[key])) return payload[key];
    }
  }
  throw new Error("Provider poll response did not contain an order list");
};

/**
 * Polls every enabled connection once. Returns a per-connection summary so a
 * caller (CLI or scheduled tick) can log or surface failures.
 */
export const pollIntegrationsOnce = async ({ now = () => new Date() } = {}) => {
  if (!hasSecretKey()) return { skipped: "secret-key-missing", connections: [] };

  const [connections] = await pool.query(
    "SELECT id, business_id, provider, settings, status FROM integration_connections WHERE status IN ('pending','reachable','connected') ORDER BY business_id, provider",
  );
  const results = [];

  for (const connection of connections) {
    const settings = parseSettings(connection.settings);
    if (settings.poll_enabled !== true || typeof settings.poll_url !== "string") {
      results.push({ connection_id: connection.id, skipped: "polling-not-configured" });
      continue;
    }
    const credentials = await loadCredentials(connection.business_id, connection.id);
    if (!credentials) {
      results.push({ connection_id: connection.id, skipped: "credentials-missing" });
      continue;
    }

    let request;
    try {
      request = buildRequest(settings, credentials);
    } catch (error) {
      results.push({ connection_id: connection.id, error: error.message });
      continue;
    }

    try {
      const status = await requestPublicHttps(request.url, {
        method: "GET",
        headers: { Authorization: `Bearer ${request.token}` },
      });
      if (status < 200 || status >= 300) throw new Error(`Provider poll returned HTTP ${status}`);

      const body = await requestProviderBody(request.url, request.token);
      if (Buffer.byteLength(body, "utf8") > MAX_POLL_PAGE_BYTES) {
        throw new Error("Provider poll response exceeded 256 KB");
      }
      const payload = JSON.parse(body);
      const orders = extractOrders(payload);
      let imported = 0;
      let duplicates = 0;

      for (const rawOrder of orders) {
        const normalized = normalizeOpenDeliveryOrder(rawOrder);
        const outcome = await persistPolledOrder(connection, normalized, now);
        if (outcome === "duplicate") duplicates += 1;
        else imported += 1;
      }

      await pool.query(
        "UPDATE integration_connections SET last_checked_at = ?, last_error = NULL WHERE id = ? AND business_id = ?",
        [now().toISOString(), connection.id, connection.business_id],
      );
      results.push({ connection_id: connection.id, imported, duplicates, status });
    } catch (error) {
      await pool.query(
        "UPDATE integration_connections SET last_checked_at = ?, last_error = ? WHERE id = ? AND business_id = ?",
        [now().toISOString(), `Polling failed: ${error.message}`.slice(0, 500), connection.id, connection.business_id],
      ).catch(() => {});
      results.push({ connection_id: connection.id, error: error.message });
    }
  }

  return { connections: results };
};

const persistPolledOrder = async (connection, normalized, now) => {
  const dbConnection = await pool.getConnection();
  try {
    await dbConnection.beginTransaction();
    const [existing] = await dbConnection.query(
      "SELECT id FROM external_orders WHERE integration_connection_id = ? AND external_order_id = ? LIMIT 1",
      [connection.id, normalized.external_order_id],
    );
    if (existing.length) {
      await dbConnection.query(
        "INSERT INTO integration_events (id, business_id, integration_connection_id, external_order_id, direction, event_type, status, payload, processed_at) VALUES (?, ?, ?, ?, 'inbound', 'order.received', 'processed', ?, ?)",
        [randomUUID(), connection.business_id, connection.id, normalized.external_order_id, JSON.stringify(normalized), now().toISOString()],
      );
      await dbConnection.commit();
      return "duplicate";
    }
    await dbConnection.query(
      "INSERT INTO integration_events (id, business_id, integration_connection_id, external_order_id, direction, event_type, status, payload, processed_at) VALUES (?, ?, ?, ?, 'inbound', 'order.received', 'processed', ?, ?)",
      [randomUUID(), connection.business_id, connection.id, normalized.external_order_id, JSON.stringify(normalized), now().toISOString()],
    );
    await dbConnection.query(
      "INSERT INTO external_orders (id, business_id, integration_connection_id, external_order_id, status, payload, received_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [randomUUID(), connection.business_id, connection.id, normalized.external_order_id, normalizeOpenDeliveryStatus(normalized.status) || "received", JSON.stringify(normalized), normalized.received_at || now().toISOString()],
    );
    await dbConnection.commit();
    return "imported";
  } catch (error) {
    await dbConnection.rollback();
    throw error;
  } finally {
    dbConnection.release();
  }
};

// requestPublicHttps returns only the status code. Polling needs the body, so
// perform a second, identical SSRF-checked request through the same helper.
const requestProviderBody = async (url, token) => {
  const { requestPublicHttpsBody } = await import("./outbound-request.js");
  return requestPublicHttpsBody(url, { method: "GET", headers: { Authorization: `Bearer ${token}` } });
};

export const startPollingLoop = ({ intervalMs = DEFAULT_POLL_INTERVAL_MS, onTick } = {}) => {
  let timer;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await pollIntegrationsOnce();
      onTick?.(result);
    } catch (error) {
      onTick?.({ error: error.message });
    } finally {
      running = false;
    }
  };
  timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  return {
    tick,
    stop: () => clearInterval(timer),
  };
};
