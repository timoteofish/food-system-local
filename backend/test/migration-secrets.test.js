import test from "node:test";
import assert from "node:assert/strict";
import { migrateLegacyIntegrationCredentials } from "../src/migration-secrets.js";

const makeConnection = (rows, columnExists = true) => {
  const writes = [];
  return {
    writes,
    async query(sql, values) {
      if (sql.includes("information_schema.columns")) return [columnExists ? [{ present: 1 }] : []];
      if (sql.startsWith("SELECT id, business_id, credentials")) return [rows];
      if (sql.startsWith("INSERT INTO secure_secrets")) { writes.push({ sql, values }); return [{ affectedRows: 1 }]; }
      throw new Error(`Unexpected migration query: ${sql}`);
    },
  };
};

test("legacy integration credentials are encrypted into the secure secret store", async () => {
  const connection = makeConnection([
    { id: "integration-id", business_id: "business-id", credentials: '{"api_token":"legacy-secret"}' },
  ]);
  await migrateLegacyIntegrationCredentials(connection, (value) => `encrypted:${value}`, () => "secret-row-id");
  assert.equal(connection.writes.length, 1);
  assert.deepEqual(connection.writes[0].values, ["secret-row-id", "business-id", "integration:integration-id", 'encrypted:{"api_token":"legacy-secret"}']);
  assert.match(connection.writes[0].sql, /ON DUPLICATE KEY UPDATE encrypted_value/);
});

test("invalid legacy integration credentials abort before source-column removal", async () => {
  const connection = makeConnection([
    { id: "integration-id", business_id: "business-id", credentials: "{invalid" },
  ]);
  await assert.rejects(migrateLegacyIntegrationCredentials(connection, (value) => value), /migration stopped without dropping the source column/);
  assert.equal(connection.writes.length, 0);
});

test("credential migration is a no-op after the legacy column has already been removed", async () => {
  const connection = makeConnection([], false);
  await migrateLegacyIntegrationCredentials(connection, (value) => value);
  assert.equal(connection.writes.length, 0);
});
