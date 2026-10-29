import test from "node:test";
import assert from "node:assert/strict";
import { isPublicAddress, resolvePublicHttpsAddress } from "../src/outbound-request.js";

test("outbound HTTPS address checks reject non-public IPv4 ranges", () => {
  for (const address of [
    "127.0.0.1", "10.20.30.40", "172.20.1.2", "192.168.1.1", "169.254.169.254",
    "100.64.0.1", "192.0.2.10", "198.18.0.1", "203.0.113.5", "224.0.0.1", "255.255.255.255",
  ]) assert.equal(isPublicAddress(address), false, `${address} must be denied`);
  assert.equal(isPublicAddress("8.8.8.8"), true);
});

test("outbound HTTPS address checks reject special and transition IPv6 ranges", () => {
  for (const address of [
    "::", "::1", "::ffff:127.0.0.1", "64:ff9b::a9fe:a9fe", "64:ff9b:1::a00:1", "100::1", "2001::1",
    "2001:db8::1", "2002:7f00:1::", "3fff::1", "fc00::1", "fe80::1", "ff02::1",
  ]) assert.equal(isPublicAddress(address), false, `${address} must be denied`);
  assert.equal(isPublicAddress("2606:4700:4700::1111"), true);
});

test("outbound HTTPS address checks reject invalid address literals", () => {
  assert.equal(isPublicAddress("not-an-ip"), false);
});

test("outbound HTTPS resolution pins a public address and rejects mixed public/private DNS answers", async () => {
  const resolved = await resolvePublicHttpsAddress(new URL("https://provider.example"), async () => [
    { address: "8.8.8.8", family: 4 },
    { address: "1.1.1.1", family: 4 },
  ]);
  assert.deepEqual(resolved, { address: "8.8.8.8", family: 4 });
  await assert.rejects(
    resolvePublicHttpsAddress(new URL("https://provider.example"), async () => [
      { address: "8.8.8.8", family: 4 },
      { address: "192.168.1.20", family: 4 },
    ]),
    /resolve only to public addresses/,
  );
  await assert.rejects(resolvePublicHttpsAddress(new URL("http://provider.example")), /must use HTTPS/);
  await assert.rejects(resolvePublicHttpsAddress(new URL("https://user:secret@provider.example")), /embedded credentials/);
});
