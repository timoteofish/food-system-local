import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const desktopDir = dirname(fileURLToPath(import.meta.url));
const launcher = resolve(desktopDir, "launcher.mjs");
const child = spawn(process.execPath, [launcher], {
  cwd: resolve(desktopDir, ".."),
  detached: true,
  stdio: "ignore",
  windowsHide: true,
});
child.unref();
