import mysql from "mysql2/promise";
import { config } from "./config.js";

const createPool = (credentials) => mysql.createPool({
  ...credentials,
  waitForConnections: true,
  connectionLimit: credentials.connectionLimit,
  charset: "utf8mb4",
});

export const pool = createPool(config.mysql);
let maintenancePool;
export const getMaintenancePool = () => {
  maintenancePool ||= createPool(config.mysqlMaintenance);
  return maintenancePool;
};

export const checkDatabase = async () => {
  const connection = await pool.getConnection();
  try {
    await connection.query("SELECT 1");
  } finally {
    connection.release();
  }
};
