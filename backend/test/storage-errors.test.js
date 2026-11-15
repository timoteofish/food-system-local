import test from "node:test";
import assert from "node:assert/strict";
import { isInvalidBackup, isStorageFull, STORAGE_FULL_SIGNAL } from "../src/storage-errors.js";

test("storage errors are recognized by code or the subprocess signal", () => {
  assert.equal(isStorageFull({ code: "ENOSPC" }), true);
  assert.equal(isStorageFull({ code: "EDQUOT" }), true);
  assert.equal(isStorageFull({ errcode: 13 }), true);
  assert.equal(isStorageFull({ cause: { code: "ENOSPC" } }), true);
  assert.equal(isStorageFull({ stderr: `other error\n${STORAGE_FULL_SIGNAL}\n` }), true);
  assert.equal(isStorageFull({ code: "EACCES" }), false);
  assert.equal(isStorageFull({ stderr: `prefix${STORAGE_FULL_SIGNAL}suffix` }), false);
  assert.equal(isInvalidBackup({ stderr: "FOOD_SYSTEM_BACKUP_INVALID\n" }), true);
  assert.equal(isInvalidBackup({ stderr: "prefixFOOD_SYSTEM_BACKUP_INVALIDsuffix" }), false);
});
