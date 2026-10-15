import Fastify from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import { config } from "./config.js";
import { checkDatabase } from "./db.js";

const app = Fastify({ logger: true });

await app.register(sensible);
await app.register(cors, {
  origin: config.corsOrigins,
  credentials: true,
});

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
