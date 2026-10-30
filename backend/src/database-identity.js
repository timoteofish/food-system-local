import path from "node:path";

const normalizeInstallPath = (value) => path.resolve(String(value || "")).replace(/[\\/]+$/, "").toLowerCase();

export const assertSelectedMariaDb = async (connection, { installRoot, port, database }) => {
  const [rows] = await connection.query("SELECT @@basedir AS basedir, @@port AS port, @@bind_address AS bind_address, DATABASE() AS database_name");
  const identity = rows[0] || {};
  if (
    normalizeInstallPath(identity.basedir) !== normalizeInstallPath(installRoot)
    || Number(identity.port) !== Number(port)
    || identity.bind_address !== "127.0.0.1"
    || identity.database_name !== database
  ) {
    throw new Error("Connected MariaDB instance does not match the selected local installation and loopback configuration");
  }
};
