import { readFileSync } from "node:fs";

export const configuredMariaRoot = ({ environmentRoot = "", environmentFile = "" } = {}) => {
  if (typeof environmentRoot === "string" && environmentRoot.trim()) return environmentRoot.trim();
  if (typeof environmentFile !== "string" || !environmentFile) return "";

  try {
    const line = readFileSync(environmentFile, "utf8")
      .split(/\r?\n/)
      .find((value) => /^\s*MARIADB_ROOT\s*=/.test(value));
    if (!line) return "";
    const value = line.slice(line.indexOf("=") + 1).trim();
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      return value.slice(1, -1).trim();
    }
    return value;
  } catch {
    return "";
  }
};
