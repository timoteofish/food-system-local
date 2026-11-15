import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { ensureLocalSecretKey } from "./local-secret.js";

dotenv.config(process.env.FOOD_SYSTEM_ENV_FILE ? { path: process.env.FOOD_SYSTEM_ENV_FILE } : undefined);

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectRoot = path.resolve(backendRoot, "..");
await ensureLocalSecretKey({ backendRoot, projectRoot });

await import("./server.js");
