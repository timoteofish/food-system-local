import "dotenv/config";

const numberFromEnv = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
};
const isLoopback = (host) => ["127.0.0.1", "localhost", "::1"].includes(host);
const nodeEnv = process.env.NODE_ENV || "development";
const host = process.env.HOST || "127.0.0.1";
const mysqlHost = process.env.MYSQL_HOST || "127.0.0.1";
const updateUrl = process.env.UPDATE_URL || "";
const updateSignature = process.env.UPDATE_SIGNATURE || "";
const updatePublicKey = process.env.UPDATE_PUBLIC_KEY || "";
if (updateUrl && !/^https:\/\//i.test(updateUrl)) throw new Error("UPDATE_URL must use HTTPS");
if (nodeEnv === "production" && updateUrl && (!updateSignature || !updatePublicKey)) throw new Error("UPDATE_SIGNATURE and UPDATE_PUBLIC_KEY are required for production updates");
if (nodeEnv === "production" && !process.env.MYSQL_PASSWORD) throw new Error("MYSQL_PASSWORD is required in production");
if (nodeEnv === "production" && !isLoopback(host) && !process.env.FOOD_SYSTEM_SECRET_KEY) throw new Error("FOOD_SYSTEM_SECRET_KEY is required when the API is exposed");
if (process.env.FOOD_SYSTEM_SECRET_KEY && process.env.FOOD_SYSTEM_SECRET_KEY.length < 32) throw new Error("FOOD_SYSTEM_SECRET_KEY must contain at least 32 characters");

export const config = {
  nodeEnv,
  host,
  port: numberFromEnv("PORT", 3000),
  appVersion: process.env.APP_VERSION || "0.1.0",
  update: {
    version: process.env.UPDATE_VERSION || process.env.APP_VERSION || "0.1.0",
    url: updateUrl,
    sha256: process.env.UPDATE_SHA256 || "",
    signature: updateSignature,
    publicKey: updatePublicKey,
    notes: process.env.UPDATE_NOTES || "",
  },
  corsOrigins: (process.env.CORS_ORIGINS || "http://localhost:4173,http://127.0.0.1:4173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  allowLocalHeader: process.env.ALLOW_LOCAL_HEADER === "true" || (process.env.ALLOW_LOCAL_HEADER !== "false" && nodeEnv !== "production" && isLoopback(host)),
  sessionDays: Math.max(1, numberFromEnv("SESSION_DAYS", 7)),
  mysql: {
    host: mysqlHost,
    port: numberFromEnv("MYSQL_PORT", 3306),
    database: process.env.MYSQL_DATABASE || "food_system",
    user: process.env.MYSQL_USER || "food_system",
    password: process.env.MYSQL_PASSWORD || "",
    connectionLimit: numberFromEnv("MYSQL_CONNECTION_LIMIT", 10),
  },
};
