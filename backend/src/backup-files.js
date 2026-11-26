import { randomUUID } from "node:crypto";

const backupNamePattern = /^food-system-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\.sqlite\.enc$/;
const displayNamePattern = /^[^\x00-\x1f\x7f]{1,80}$/;

export const isSafeBackupName = (name) => typeof name === "string" && backupNamePattern.test(name);
export const createBackupName = (date = new Date(), id = randomUUID()) => {
  const stamp = date.toISOString().replace(/[:.]/g, "-");
  const name = `food-system-${stamp}-${id}.sqlite.enc`;
  if (!isSafeBackupName(name)) throw new Error("Invalid generated backup name");
  return name;
};

// Friendly display names are metadata only. They are never used as file names
// or as identifiers for download, restore or delete operations.
export const isSafeDisplayName = (value) => typeof value === "string" && displayNamePattern.test(value.trim());
export const normalizeDisplayName = (value) => typeof value === "string" ? value.trim() : "";
export const metadataName = (name) => `${name}.meta.json`;
