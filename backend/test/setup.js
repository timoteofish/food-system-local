import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Never let tests open the developer's default SQLite database implicitly.
if (!process.env.FOOD_SYSTEM_DATA_DIR && !process.env.FOOD_SYSTEM_DB_PATH) {
  const directory = mkdtempSync(path.join(tmpdir(), "food-system-test-"));
  process.env.FOOD_SYSTEM_DATA_DIR = directory;
  process.env.FOOD_SYSTEM_TEST_AUTO_DATA_DIR = "1";
  process.once("exit", () => { try { rmSync(directory, { recursive: true, force: true }); } catch {} });
}
