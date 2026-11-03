import { copyFile, access, chmod, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { replaceDatabase } from "./db.js";

const input = process.argv[2];
if (!input) throw new Error("Usage: node src/restore.js path/to/food-system.sqlite");
await access(input);
const candidate = new DatabaseSync(input, { readOnly: true, enableForeignKeyConstraints: true, enableDoubleQuotedStringLiterals: false, timeout: 5000 });
try {
  candidate.exec("PRAGMA trusted_schema = OFF");
  const integrity = candidate.prepare("PRAGMA integrity_check").get();
  const tables = new Set(candidate.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name));
  const baseline = tables.has("app_schema_migrations") && candidate.prepare("SELECT 1 FROM app_schema_migrations WHERE version = '025_mariadb_schema_baseline'").get();
  if (integrity.integrity_check !== "ok" || candidate.prepare("PRAGMA foreign_key_check").all().length || !tables.has("businesses") || !baseline) {
    throw new Error("SQLite restore source is invalid or does not contain a Food System database");
  }
} finally { candidate.close(); }
const staged = path.resolve(`${input}.${randomUUID()}.restore`);
try {
  await copyFile(input, staged);
  await chmod(staged, 0o600).catch(() => {});
  await replaceDatabase(staged);
} finally { await rm(staged, { force: true }); }
console.log("SQLite database restored");
