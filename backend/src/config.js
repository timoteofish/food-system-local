import dotenv from "dotenv";
dotenv.config(process.env.FOOD_SYSTEM_ENV_FILE ? { path: process.env.FOOD_SYSTEM_ENV_FILE } : undefined);

const numberFromEnv = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
};
const isLoopback = (host) => ["127.0.0.1", "localhost", "::1"].includes(host);
const nodeEnv = process.env.NODE_ENV || "development";
const host = process.env.HOST || "127.0.0.1";
const rawUpdateUrl = process.env.UPDATE_URL || "";
let updateUrl = "";
if (rawUpdateUrl) {
  let parsedUpdateUrl;
  try { parsedUpdateUrl = new URL(rawUpdateUrl); }
  catch { throw new Error("UPDATE_URL must be a valid HTTPS URL without embedded credentials"); }
  if (parsedUpdateUrl.protocol !== "https:" || parsedUpdateUrl.username || parsedUpdateUrl.password || parsedUpdateUrl.hash || rawUpdateUrl.length > 2048) {
    throw new Error("UPDATE_URL must be a valid HTTPS URL without embedded credentials or a fragment");
  }
  updateUrl = parsedUpdateUrl.toString();
}
const updateSha256 = process.env.UPDATE_SHA256 || "";
const updateSignature = process.env.UPDATE_SIGNATURE || "";
const updatePublicKey = process.env.UPDATE_PUBLIC_KEY || "";
if (nodeEnv === "production" && updateUrl && (!/^[a-f0-9]{64}$/i.test(updateSha256) || !updateSignature || !updatePublicKey)) throw new Error("A valid UPDATE_SHA256, UPDATE_SIGNATURE, and UPDATE_PUBLIC_KEY are required for production updates");
if (nodeEnv === "production" && !isLoopback(host)) throw new Error("The production API must bind to a loopback address");
if (process.env.FOOD_SYSTEM_SECRET_KEY && process.env.FOOD_SYSTEM_SECRET_KEY.length < 32) throw new Error("FOOD_SYSTEM_SECRET_KEY must contain at least 32 characters");

export const config = {
  nodeEnv,
  host,
  port: numberFromEnv("PORT", 3000),
  appVersion: process.env.APP_VERSION || "0.1.0",
  update: {
    version: process.env.UPDATE_VERSION || process.env.APP_VERSION || "0.1.0",
    url: updateUrl,
    sha256: updateSha256,
    signature: updateSignature,
    publicKey: updatePublicKey,
    notes: process.env.UPDATE_NOTES || "",
  },
  corsOrigins: (process.env.CORS_ORIGINS || "http://localhost:4173,http://127.0.0.1:4173,http://tauri.localhost,tauri://localhost")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  localAccessToken: process.env.FOOD_SYSTEM_LOCAL_ACCESS_TOKEN || "",
  allowLocalHeader: nodeEnv !== "production" && isLoopback(host) && process.env.ALLOW_LOCAL_HEADER !== "false",
  sessionDays: Math.max(1, numberFromEnv("SESSION_DAYS", 7)),
};
