import Fastify from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import { config } from "./config.js";
import { checkDatabase } from "./db.js";
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

const app = Fastify({ logger: true, trustProxy: false });

await app.register(sensible);
await app.register(cors, {
  origin: (origin, callback) => {
    if (!origin || config.corsOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Origin not allowed"), false);
  },
  credentials: false,
});
app.addHook("onSend", async (_request, reply) => {
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("X-Frame-Options", "DENY");
  reply.header("Referrer-Policy", "no-referrer");
  reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (config.nodeEnv === "production") reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
});
app.addHook("onResponse", async (request, reply) => {
  if (!request.user || request.user.local || request.auditRecorded || !["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return;
  try {
    await audit(request, request.user, `HTTP ${request.method} ${request.routeOptions?.url || request.url}`.slice(0, 120), null, null, { status_code: reply.statusCode });
  } catch (error) {
    app.log.error(error, "Administrative audit write failed");
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

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
