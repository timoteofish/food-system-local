import test from "node:test";
import assert from "node:assert/strict";
import { createBackupName, isSafeBackupName } from "../src/backup-files.js";

test("backup name validation accepts generated UUID names and rejects paths", () => {
  assert.equal(createBackupName(new Date("2026-10-29T12:34:56.789Z"), "a1b2c3d4-e5f6-4a7b-8c9d-0123456789ab"), "food-system-2026-10-29T12-34-56-789Z-a1b2c3d4-e5f6-4a7b-8c9d-0123456789ab.sql.enc");
  assert.equal(isSafeBackupName("food-system-2026-10-29T12-34-56-789Z-a1b2c3d4-e5f6-4a7b-8c9d-0123456789ab.sql.enc"), true);
  assert.equal(isSafeBackupName("food-system-2026-10-29T12-34-56-789Z-01234567-89ab-cdef-0123-456789abcdef.sql.enc"), true);
  assert.equal(isSafeBackupName("../food-system-2026-10-29T12-34-56-789Z-a1b2c3d4-e5f6-4a7b-8c9d-0123456789ab.sql.enc"), false);
  assert.equal(isSafeBackupName("food-system-2026-10-29T12-34-56-789Z-../../backup.sql.enc"), false);
  assert.equal(isSafeBackupName(null), false);
});
