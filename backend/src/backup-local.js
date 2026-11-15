import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { ensureLocalSecretKey } from "./local-secret.js";

dotenv.config(process.env.FOOD_SYSTEM_ENV_FILE ? { path: process.env.FOOD_SYSTEM_ENV_FILE } : undefined);
delete process.env.FOOD_SYSTEM_INTERNAL_RESTORE_BACKUP;

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await ensureLocalSecretKey({ backendRoot });
await import("./backup.js");
