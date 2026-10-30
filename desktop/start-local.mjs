import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const desktopDir = dirname(fileURLToPath(import.meta.url));
const launcher = resolve(desktopDir, "launcher.mjs");
const projectRoot = resolve(desktopDir, "..");
const appDataRoot = process.env.APPDATA || process.env.LOCALAPPDATA;
if (!appDataRoot) throw new Error("Windows APPDATA or LOCALAPPDATA must be available to start Food System.");
const dataDir = join(appDataRoot, "com.foodsystem.local");
const secretPath = join(dataDir, "secret.key");
await mkdir(dataDir, { recursive: true });
let secretKey;
try {
  secretKey = (await readFile(secretPath, "utf8")).trim();
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  secretKey = execFileSync(process.execPath, ["-e", "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64url'))"], { encoding: "utf8" });
  try { await writeFile(secretPath, `${secretKey}\n`, { flag: "wx", mode: 0o600 }); }
  catch (writeError) {
    if (writeError.code !== "EEXIST") throw writeError;
    secretKey = (await readFile(secretPath, "utf8")).trim();
  }
}
if (secretKey.length < 32) throw new Error("The development encryption key is invalid.");
const child = spawn(process.execPath, [launcher], {
  cwd: projectRoot,
  env: {
    ...process.env,
    NODE_ENV: "development",
    FOOD_SYSTEM_DATA_DIR: dataDir,
    FOOD_SYSTEM_ENV_FILE: join(dataDir, "config.env"),
    FOOD_SYSTEM_SECRET_KEY: secretKey,
    FOOD_SYSTEM_PARENT_PID: String(process.pid),
    FOOD_SYSTEM_TAURI_CONTROL: "1",
  },
  stdio: ["pipe", "inherit", "inherit"],
  windowsHide: true,
});

let shutdownRequested = false;
let shutdownTimer = null;
const stopLauncher = () => {
  if (shutdownRequested || child.exitCode !== null || child.signalCode !== null) return;
  shutdownRequested = true;
  try { child.stdin.write('{"type":"shutdown"}\n'); } catch {}
  shutdownTimer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }, 450_000);
  shutdownTimer.unref();
};
process.on("SIGINT", stopLauncher);
process.on("SIGTERM", stopLauncher);

const exitCode = await new Promise((resolveExit) => {
  child.once("error", () => { if (shutdownTimer) clearTimeout(shutdownTimer); resolveExit(1); });
  child.once("exit", (code) => { if (shutdownTimer) clearTimeout(shutdownTimer); resolveExit(code ?? 1); });
});
process.exitCode = exitCode;
