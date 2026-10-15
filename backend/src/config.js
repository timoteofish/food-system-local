import "dotenv/config";

const numberFromEnv = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
};

export const config = {
  nodeEnv: process.env.NODE_ENV || "development",
  host: process.env.HOST || "127.0.0.1",
  port: numberFromEnv("PORT", 3000),
  corsOrigins: (process.env.CORS_ORIGINS || "http://localhost:4173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  mysql: {
    host: process.env.MYSQL_HOST || "127.0.0.1",
    port: numberFromEnv("MYSQL_PORT", 3306),
    database: process.env.MYSQL_DATABASE || "food_system",
    user: process.env.MYSQL_USER || "food_system",
    password: process.env.MYSQL_PASSWORD || "",
    connectionLimit: numberFromEnv("MYSQL_CONNECTION_LIMIT", 10),
  },
};
