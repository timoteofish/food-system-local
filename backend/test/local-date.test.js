import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

test("local day boundaries account for time zone and daylight saving changes", () => {
  const moduleUrl = new URL("../src/local-date.js", import.meta.url).href;
  const code = `import {localDayBoundaryUtc,localDateString} from ${JSON.stringify(moduleUrl)}; console.log(JSON.stringify([localDayBoundaryUtc('2026-11-13'),localDayBoundaryUtc('2026-11-13',true),localDayBoundaryUtc('2026-03-08'),localDayBoundaryUtc('2026-03-08',true),localDateString(new Date('2026-11-14T02:59:59Z')),localDateString(new Date('2026-11-14T03:00:00Z'))]));`;
  const run = (TZ) => JSON.parse(execFileSync(process.execPath, ["--input-type=module", "--eval", code], { env: { ...process.env, TZ }, encoding: "utf8" }));
  assert.deepEqual(run("America/Sao_Paulo").slice(0, 2), ["2026-11-13 03:00:00", "2026-11-14 03:00:00"]);
  assert.deepEqual(run("America/Sao_Paulo").slice(4), ["2026-11-13", "2026-11-14"]);
  assert.deepEqual(run("America/New_York").slice(2, 4), ["2026-03-08 05:00:00", "2026-03-09 04:00:00"]);
});
