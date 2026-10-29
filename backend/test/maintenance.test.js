import test from "node:test";
import assert from "node:assert/strict";
import { beginRestore, endRestore, enterRequest, isRestoreInProgress, leaveRequest } from "../src/maintenance.js";

test("database restore waits for active requests and rejects new work", async () => {
  assert.equal(enterRequest(), true); // Restore request.
  assert.equal(enterRequest(), true); // Request already running when restore starts.

  const restore = beginRestore();
  assert.equal(isRestoreInProgress(), true);
  assert.equal(enterRequest(), false);
  assert.equal(await beginRestore(), false);

  leaveRequest();
  assert.equal(await restore, true);
  leaveRequest();
  endRestore();
  assert.equal(isRestoreInProgress(), false);
  assert.equal(enterRequest(), true);
  leaveRequest();
});
