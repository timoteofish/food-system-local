import dotenv from "dotenv";

// Load before importing modules that resolve the database and lock paths.
dotenv.config(process.env.FOOD_SYSTEM_ENV_FILE ? { path: process.env.FOOD_SYSTEM_ENV_FILE } : undefined);
