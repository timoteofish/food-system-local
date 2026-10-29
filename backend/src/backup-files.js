import { randomUUID } from "node:crypto";

const backupNamePattern = /^food-system-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\.sql\.enc$/;

export const isSafeBackupName = (name) => typeof name === "string" && backupNamePattern.test(name);

export const createBackupName = (date = new Date(), id = randomUUID()) => {
  const stamp = date.toISOString().replace(/[:.]/g, "-");
  const name = `food-system-${stamp}-${id}.sql.enc`;
  if (!isSafeBackupName(name)) throw new Error("Invalid generated backup name");
  return name;
};
