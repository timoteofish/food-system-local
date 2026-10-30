import Fastify from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import { config } from "./config.js";
import { checkDatabase, pool } from "./db.js";
import businessesRoutes from "./routes/businesses.js";
import catalogRoutes from "./routes/catalog.js";
import tableRoutes from "./routes/tables.js";
import diningTabRoutes from "./routes/dining-tabs.js";
import orderRoutes from "./routes/orders.js";
import cashRoutes from "./routes/cash.js";
import authRoutes from "./routes/auth.js";
import platformRoutes from "./routes/platform.js";
import integrationRoutes from "./routes/integrations.js";
import inventoryRoutes from "./routes/inventory.js";
import operationsRoutes from "./routes/operations.js";
import customerValueRoutes from "./routes/customer-value.js";
import reportRoutes from "./routes/reports.js";
import backupRoutes from "./routes/backups.js";
import fiscalRoutes from "./routes/fiscal.js";
import deliveryRoutes from "./routes/delivery.js";
import kitchenRoutes from "./routes/kitchen.js";
import { audit } from "./audit.js";
import { enterRequest, leaveRequest } from "./maintenance.js";

const app = Fastify({ logger: true, trustProxy: false, bodyLimit: 5 * 1024 * 1024 });
let shutdownStarted = false;
const authAttempts = new Map();
const authLimits = new Map([
  ["/api/v1/auth/login", { limit: 10, windowMs: 15 * 60 * 1000 }],
  ["/api/v1/auth/register", { limit: 20, windowMs: 60 * 60 * 1000 }],
]);
const testRateLimitBypass = config.nodeEnv === "test" && process.env.FOOD_SYSTEM_TEST_DISABLE_AUTH_RATE_LIMIT === "1";

await app.register(sensible);
await app.register(cors, {
  origin: (origin, callback) => {
    if (!origin || config.corsOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Origin not allowed"), false);
  },
  credentials: false,
});
app.addHook("onRequest", async (request, reply) => {
  if (!enterRequest()) return reply.serviceUnavailable("Database restore is in progress; retry shortly");
  request.maintenanceRequest = true;
});
const releaseMaintenanceRequest = (request) => {
  if (!request.maintenanceRequest) return;
  request.maintenanceRequest = false;
  leaveRequest();
};
app.addHook("onRequestAbort", async (request) => {
  releaseMaintenanceRequest(request);
});
app.addHook("onRequest", async (request, reply) => {
  if (testRateLimitBypass) return;
  const policy = authLimits.get(request.routeOptions.url);
  if (!policy) return;
  const now = Date.now();
  const key = `${request.ip}:${request.routeOptions.url}`;
  if (authAttempts.size >= 8000) {
    for (const [candidate, value] of authAttempts) if (value.resetAt <= now) authAttempts.delete(candidate);
  }
  if (!authAttempts.has(key) && authAttempts.size >= 10000) {
    reply.header("Retry-After", Math.max(1, Math.ceil(policy.windowMs / 1000)));
    return reply.code(429).send({ error: "Authentication is temporarily rate limited. Try again later." });
  }
  let attempt = authAttempts.get(key);
  if (!attempt || attempt.resetAt <= now) attempt = { count: 0, resetAt: now + policy.windowMs };
  attempt.count += 1;
  authAttempts.set(key, attempt);
  reply.header("RateLimit-Limit", policy.limit);
  reply.header("RateLimit-Remaining", Math.max(0, policy.limit - attempt.count));
  reply.header("RateLimit-Reset", Math.ceil(attempt.resetAt / 1000));
  if (attempt.count > policy.limit) {
    reply.header("Retry-After", Math.max(1, Math.ceil((attempt.resetAt - now) / 1000)));
    return reply.code(429).send({ error: "Too many authentication attempts. Try again later." });
  }
});
app.addHook("onSend", async (_request, reply) => {
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("X-Frame-Options", "DENY");
  reply.header("Referrer-Policy", "no-referrer");
  reply.header("Cache-Control", "no-store");
  reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (config.nodeEnv === "production") reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
});
app.addHook("onResponse", async (request, reply) => {
  try {
    if (!request.user || request.auditRecorded || !["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return;
    try {
      await audit(request, request.user, `HTTP ${request.method} ${request.routeOptions?.url || request.url}`.slice(0, 120), null, null, { status_code: reply.statusCode });
    } catch (error) {
      app.log.error(error, "Administrative audit write failed");
    }
  } finally {
    releaseMaintenanceRequest(request);
  }
});
await app.register(businessesRoutes);
await app.register(catalogRoutes);
await app.register(tableRoutes);
await app.register(diningTabRoutes);
await app.register(orderRoutes);
await app.register(cashRoutes);
await app.register(authRoutes);
await app.register(platformRoutes);
await app.register(integrationRoutes);
await app.register(inventoryRoutes);
await app.register(operationsRoutes);
await app.register(customerValueRoutes);
await app.register(reportRoutes);
await app.register(backupRoutes);
await app.register(fiscalRoutes);
await app.register(deliveryRoutes);
await app.register(kitchenRoutes);

app.get("/up", async () => ({
  status: "ok",
  service: "food-system-backend-node",
  database: "pending",
}));

app.get("/api/v1/health", async (_request, reply) => {
  try {
    await checkDatabase();
    return { status: "ok", database: "ok" };
  } catch (error) {
    app.log.error(error, "MySQL health check failed");
    return reply.code(503).send({ status: "error", database: "unavailable" });
  }
});

app.setErrorHandler((error, _request, reply) => {
  app.log.error(error);
  return reply.code(error.statusCode || 500).send({
    error: error.statusCode ? error.message : "Internal server error",
  });
});

const closeApi = async () => {
  if (shutdownStarted) return;
  shutdownStarted = true;
  if (process.connected) {
    await new Promise((resolveSent) => {
      const timer = setTimeout(resolveSent, 500);
      try {
        process.send({ type: "api-stopping" }, () => {
          clearTimeout(timer);
          resolveSent();
        });
      } catch {
        clearTimeout(timer);
        resolveSent();
      }
    });
  }
  try {
    await app.close();
  } catch (error) {
    app.log.error(error, "API shutdown failed while draining requests");
  }
  try {
    await pool.end();
  } catch (error) {
    app.log.error(error, "API shutdown failed while closing database connections");
  }
  if (process.connected) process.disconnect();
};

process.on("message", (message) => {
  if (message?.type === "shutdown") void closeApi();
});
process.on("SIGINT", () => { void closeApi(); });
process.on("SIGTERM", () => { void closeApi(); });

try {
  await app.listen({ host: config.host, port: config.port });
  if (process.connected) process.send({ type: "api-listening" });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
