import "./load-env.js";
import { access, chmod, open, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync, backup } from "node:sqlite";
import { acquireRestoreGuard, databasePath } from "./restore-coordination.js";

const input = process.argv[2];
if (!input) throw new Error("Usage: node src/restore.js path/to/food-system.sqlite");
await access(input);
const releaseGuard = await acquireRestoreGuard();
if (!releaseGuard) throw new Error("Stop API, print, backup and maintenance processes, or review an existing restore lock before restoring");
// Stage next to the destination so that the final rename stays on one filesystem.
// SQLite's backup API includes committed changes that are still in the source WAL.
const staged = `${databasePath}.${randomUUID()}.restore`;
let database;
let replacementStarted = false;
let replacementCompleted = false;
let stagedCreated = false;
try {
  database = await import("./db.js");
  const placeholder = await open(staged, "wx", 0o600);
  stagedCreated = true;
  await placeholder.close();
  const source = new DatabaseSync(path.resolve(input), { readOnly: true, enableForeignKeyConstraints: true, enableDoubleQuotedStringLiterals: false, timeout: 5000 });
  try { await backup(source, staged); } finally { source.close(); }
  await chmod(staged, 0o600).catch(() => {});
  const candidate = new DatabaseSync(staged, { readOnly: true, enableForeignKeyConstraints: true, enableDoubleQuotedStringLiterals: false, timeout: 5000 });
  try {
    candidate.exec("PRAGMA trusted_schema = OFF");
    const integrity = candidate.prepare("PRAGMA integrity_check").get();
    if (integrity.integrity_check !== "ok" || candidate.prepare("PRAGMA foreign_key_check").all().length) {
      throw new Error("SQLite restore source is invalid or does not contain a Food System database");
    }
    database.assertCompatibleSchema(candidate);
  } finally { candidate.close(); }
  replacementStarted = true;
  await database.replaceDatabase(staged);
  replacementCompleted = true;
} finally {
  let databaseClosed = false;
  try {
    try { if (stagedCreated) await rm(staged, { force: true }); }
    finally { database?.closeDatabase(); databaseClosed = true; }
  } finally {
    // An interrupted replacement may need manual recovery before another worker opens it.
    if (databaseClosed && (!replacementStarted || replacementCompleted)) await releaseGuard();
  }
}
console.log("SQLite database restored");
