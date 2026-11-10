import test from "node:test";
import assert from "node:assert/strict";
import { isLoopbackHttpOrigin } from "../src/local-origin.js";

test("recognizes local frontend origins on arbitrary development ports", () => {
  for (const origin of [
    "http://localhost:4173",
    "http://localhost:5500",
    "http://127.0.0.1:5501",
    "https://[::1]:8443",
  ]) assert.equal(isLoopbackHttpOrigin(origin), true, origin);
});

test("rejects non-loopback and non-origin URL values", () => {
  for (const origin of [
    "https://example.com",
    "http://localhost.attacker.test:5500",
    "http://localhost:5500/path",
    "http://user@localhost:5500",
    "file://localhost",
    "",
    null,
  ]) assert.equal(isLoopbackHttpOrigin(origin), false, String(origin));
});
