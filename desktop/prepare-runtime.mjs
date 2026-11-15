import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = resolve(fileURLToPath(new URL(".", import.meta.url)));
const projectRoot = resolve(desktopRoot, "..");
const backendRoot = join(projectRoot, "backend");
const runtimeName = process.platform === "win32" ? "node.exe" : "node";
const runtimePath = join(desktopRoot, "runtime", runtimeName);
const nodeVersion = process.versions.node.split(".")[0];

if (nodeVersion !== "24") {
  throw new Error(`Node.js 24 is required to bundle the backend runtime; found ${process.version}`);
}

const dependencies = [
  "fastify/package.json",
  "@fastify/cors/package.json",
  "@fastify/sensible/package.json",
  "dotenv/package.json",
];
const dependenciesReady = dependencies.every((dependency) => existsSync(join(backendRoot, "node_modules", dependency)));
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const npmVersion = spawnSync(npmCommand, ["--version"], {
  encoding: "utf8",
  shell: process.platform === "win32",
  windowsHide: true,
});

if (npmVersion.status === 0) {
  const install = spawnSync(npmCommand, ["ci", "--omit=dev"], {
    cwd: backendRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
    windowsHide: true,
  });
  if (install.error) throw install.error;
  if (install.status !== 0) throw new Error(`Could not install backend production dependencies (npm exit code ${install.status})`);
} else if (!dependenciesReady) {
  throw new Error("npm is unavailable and backend production dependencies are missing; install Node.js 24 with npm before bundling");
}

mkdirSync(join(desktopRoot, "runtime"), { recursive: true });
const sourceRuntime = resolve(process.execPath);
if (sourceRuntime !== resolve(runtimePath)) copyFileSync(sourceRuntime, runtimePath);
if (process.platform !== "win32") {
  const mode = statSync(runtimePath).mode;
  chmodSync(runtimePath, mode | 0o111);
}

console.log(`Backend production dependencies and Node.js ${process.version} are ready for bundling`);
