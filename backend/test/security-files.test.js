import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

process.env.FOOD_SYSTEM_SECRET_KEY = "security-file-test-key-which-is-long-enough";
const { decryptFile, encryptFile, encryptSecret } = await import("../src/security.js");

test("streaming backup encryption round-trips large files and authenticates ciphertext", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "food-system-backup-test-"));
  const input = path.join(directory, "dump.sql");
  const encrypted = path.join(directory, "dump.sql.enc");
  const restored = path.join(directory, "restored.sql");
  const altered = path.join(directory, "altered.sql.enc");
  const payload = `${"INSERT INTO records VALUES ('sample');\n".repeat(100_000)}COMMIT;\n`;
  try {
    await writeFile(input, payload);
    await encryptFile(input, encrypted);
    const encryptedBytes = await readFile(encrypted);
    assert.equal(encryptedBytes.subarray(0, 4).toString("ascii"), "FSS2");
    assert.ok(encryptedBytes.length < Buffer.byteLength(payload) + 64);
    await decryptFile(encrypted, restored);
    assert.equal(await readFile(restored, "utf8"), payload);

    encryptedBytes[20] ^= 1;
    await writeFile(altered, encryptedBytes);
    await assert.rejects(decryptFile(altered, path.join(directory, "tampered.sql")));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("backup restore continues to read legacy v1 encrypted files", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "food-system-legacy-backup-test-"));
  const encrypted = path.join(directory, "legacy.sql.enc");
  const restored = path.join(directory, "restored.sql");
  const payload = "CREATE TABLE legacy_backup (id INT);\n".repeat(20_000);
  try {
    await writeFile(encrypted, encryptSecret(payload));
    await decryptFile(encrypted, restored);
    assert.equal(await readFile(restored, "utf8"), payload);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
