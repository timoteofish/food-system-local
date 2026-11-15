import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

test("SQLite timestamps display and filter by the computer's local day", () => {
  const program = `
    import { parseApiTimestamp, isSameDay } from '../frontend/shared/utils/utils.js';
    const date = parseApiTimestamp('2026-01-01 01:00:00');
    const local = [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours()];
    const same = isSameDay('2026-01-01 01:00:00', new Date('2026-01-01T00:00:00Z'));
    const explicit = parseApiTimestamp('2026-01-01T01:00:00Z').toISOString();
    process.stdout.write(JSON.stringify({ local, same, explicit }));
  `;
  const run = (tz) => JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", program], { env: { ...process.env, TZ: tz }, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
  const saoPaulo = run("America/Sao_Paulo");
  assert.deepEqual(saoPaulo.local, [2025, 12, 31, 22]);
  assert.equal(saoPaulo.same, true);
  assert.equal(saoPaulo.explicit, "2026-01-01T01:00:00.000Z");
  assert.deepEqual(run("Asia/Tokyo").local, [2026, 1, 1, 10]);
});
