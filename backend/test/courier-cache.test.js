import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

test("courier cache and installed start URL refer to files the launcher can serve", async () => {
  const root = path.resolve("../frontend");
  const worker = await readFile(path.join(root, "pages/courier/sw.js"), "utf8");
  const start = worker.indexOf("const SHELL = [");
  const end = worker.indexOf("];", start);
  assert.ok(start >= 0 && end > start);
  const entries = vm.runInNewContext(worker.slice(start, end + 2) + "\nSHELL");
  const origin = new URL("https://food.example/pages/courier/");
  for (const entry of entries) {
    const target = new URL(entry, origin);
    assert.equal(target.origin, origin.origin);
    const file = path.resolve(root, `.${target.pathname}`);
    assert.ok(file.startsWith(root + path.sep));
    assert.ok((await stat(file)).isFile(), `${entry} is not a file`);
  }
  const manifest = JSON.parse(await readFile(path.join(root, "pages/courier/manifest.webmanifest"), "utf8"));
  const startUrl = new URL(manifest.start_url, origin);
  assert.ok((await stat(path.resolve(root, `.${startUrl.pathname}`))).isFile());
  assert.ok(entries.includes(manifest.start_url));
});
