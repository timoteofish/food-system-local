import test from "node:test";
import assert from "node:assert/strict";
import { assertSelectedMariaDb } from "../src/database-identity.js";

const selected = {
  installRoot: "/opt/mariadb/",
  port: 3306,
  database: "food_system",
};
const makeConnection = (identity) => ({
  query: async (sql) => {
    assert.equal(sql, "SELECT @@basedir AS basedir, @@port AS port, @@bind_address AS bind_address, DATABASE() AS database_name");
    return [[identity]];
  },
});

test("selected MariaDB identity accepts a matching loopback instance", async () => {
  await assertSelectedMariaDb(makeConnection({
    basedir: "/opt/mariadb",
    port: "3306",
    bind_address: "127.0.0.1",
    database_name: "food_system",
  }), selected);
});

for (const [field, value] of [
  ["basedir", "/opt/other-mariadb/"],
  ["port", 3307],
  ["bind_address", "0.0.0.0"],
  ["database_name", "other_database"],
]) {
  test(`selected MariaDB identity rejects a mismatched ${field}`, async () => {
    const identity = {
      basedir: "/opt/mariadb/",
      port: 3306,
      bind_address: "127.0.0.1",
      database_name: "food_system",
      [field]: value,
    };
    await assert.rejects(assertSelectedMariaDb(makeConnection(identity), selected), /does not match the selected local installation/);
  });
}
