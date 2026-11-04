import { execFile as execFileCallback, spawn } from "node:child_process";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer as createHttpServer, request as createHttpRequest } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, isAbsolute, join, normalize, relative as relativePath, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { removeStalePlaintextBackups } from "./cleanup-backups.mjs";

const execFile = promisify(execFileCallback);
let backend = null;
let backendRestoreInProgress = false;
let frontend = null;
let shuttingDown = false;
let shutdownPromise = null;
let migrationPromise = null;
const publicRequestAttempts = new Map();

const desktopRoot = resolve(fileURLToPath(new URL(".", import.meta.url)));
const root = resolve(desktopRoot, "..");
const frontendRoot = join(root, "frontend");
const backendRoot = join(root, "backend");
const defaultDataDir = process.env.APPDATA
  ? join(process.env.APPDATA, "com.foodsystem.local")
  : process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, "com.foodsystem.local")
    : process.env.XDG_DATA_HOME
      ? join(process.env.XDG_DATA_HOME, "com.foodsystem.local")
      : process.platform === "darwin"
        ? join(homedir(), "Library", "Application Support", "com.foodsystem.local")
        : join(homedir(), ".local", "share", "com.foodsystem.local");
const dataDir = process.env.FOOD_SYSTEM_DATA_DIR || defaultDataDir;
const environmentFile = process.env.FOOD_SYSTEM_ENV_FILE || join(dataDir, "config.env");
const frontendPort = Number(process.env.FRONTEND_PORT || 4173);
const frontendHost = process.env.FRONTEND_HOST || "127.0.0.1";
const nodeEnvironment = process.env.NODE_ENV || "production";
const localAccessToken = nodeEnvironment === "development"
  ? ""
  : process.env.FOOD_SYSTEM_LOCAL_ACCESS_TOKEN || randomBytes(32).toString("base64url");
const backupDir = join(dataDir, "backups");
const recoveryMarker = resolve(backupDir, "..", "restore-recovery-required");
if (existsSync(recoveryMarker)) {
  throw new Error("A database restore was interrupted or could not be recovered. Food System startup is blocked until the database and safety backup are checked by an administrator.");
}
const secretKeyPath = join(dataDir, "secret.key");
let secretKey = process.env.FOOD_SYSTEM_SECRET_KEY || "";
if (!secretKey) {
  try { secretKey = (await readFile(secretKeyPath, "utf8")).trim(); }
  catch {
    secretKey = randomBytes(32).toString("base64url");
    await mkdir(dataDir, { recursive: true });
    await writeFile(secretKeyPath, `${secretKey}\n`, { mode: 0o600, flag: "wx" }).catch(async (error) => {
      if (error.code !== "EEXIST") throw error;
      secretKey = (await readFile(secretKeyPath, "utf8")).trim();
    });
  }
}
if (secretKey.length < 32) {
  throw new Error("The local encryption key is missing or invalid. Restore the key from a backup before continuing.");
}
await mkdir(backupDir, { recursive: true });
try {
  const removedPlaintextFiles = await removeStalePlaintextBackups(backupDir);
  if (removedPlaintextFiles.length) console.warn(`Removed ${removedPlaintextFiles.length} stale plaintext backup file(s).`);
} catch (error) {
  console.warn("Food System could not clean stale plaintext backup files:", error.message);
}
if (!existsSync(frontendRoot) || !existsSync(join(backendRoot, "src", "server.js"))) {
  throw new Error(`Food System resources are incomplete. Expected frontend and backend below ${root}`);
}
const tlsKeyPath = process.env.FRONTEND_TLS_KEY || "";
const tlsCertPath = process.env.FRONTEND_TLS_CERT || "";
if (!["127.0.0.1", "localhost", "::1"].includes(frontendHost) && (!tlsKeyPath || !tlsCertPath)) {
  throw new Error("FRONTEND_TLS_KEY and FRONTEND_TLS_CERT are required when the menu is exposed on the network");
}

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

const safePath = (urlPath) => {
  const requested = decodeURIComponent(String(urlPath || "/").split("?")[0]);
  const relative = requested === "/"
    ? "index.html"
    : requested.replace(/^\/+/, "").replace(/^frontend\//, "");
  const file = resolve(frontendRoot, normalize(relative));
  const pathFromFrontend = relativePath(frontendRoot, file);
  if (pathFromFrontend === ".." || pathFromFrontend.startsWith(`..${sep}`) || isAbsolute(pathFromFrontend)) return null;
  return file;
};

const waitForChildExit = (child, timeoutMs) => {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolveExit) => {
    let finished = false;
    const finish = (exited) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      child.removeListener("exit", onExit);
      child.removeListener("error", onError);
      resolveExit(exited);
    };
    const onExit = () => finish(true);
    const onError = () => finish(child.exitCode !== null || child.signalCode !== null);
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once("exit", onExit);
    child.once("error", onError);
  });
};

const waitForApiListener = (child, timeoutMs = 10_000) => new Promise((resolveApi, rejectApi) => {
  let settled = false;
  const finish = (error) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    child.removeListener("message", onMessage);
    child.removeListener("exit", onExit);
    child.removeListener("error", onError);
    if (error) rejectApi(error);
    else resolveApi();
  };
  const onMessage = (message) => {
    if (message?.type === "api-listening") finish();
  };
  const onExit = (code, signal) => finish(new Error(`Local API exited before binding port 3000 (code ${code ?? signal})`));
  const onError = (error) => finish(error);
  const timer = setTimeout(() => finish(new Error("Local API did not bind port 3000 within 10 seconds")), timeoutMs);
  child.on("message", onMessage);
  child.once("exit", onExit);
  child.once("error", onError);
});

const shutdown = () => {
  if (shutdownPromise) return shutdownPromise;
  shuttingDown = true;
  if (frontend?.listening) frontend.close();
  shutdownPromise = (async () => {
    if (migrationPromise) {
      // Never interrupt a migration backup or DDL sequence because the window closed.
      await migrationPromise.then(() => {}, () => {});
    }
    if (backend && backend.exitCode === null && backend.signalCode === null) {
      if (backend.connected) {
        await new Promise((resolveSend) => {
          let settled = false;
          const finish = (sent) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolveSend(sent);
          };
          const timer = setTimeout(() => finish(false), 2_000);
          try {
            backend.send({ type: "shutdown" }, (error) => finish(!error));
          } catch {
            finish(false);
          }
        });
      }
      const stopped = await waitForChildExit(backend, 400_000);
      if (!stopped) {
        console.warn("Food System API is still finishing an operation; leaving the API running rather than interrupting it.");
        if (backend.connected) backend.disconnect();
        backend.unref();
        return;
      }
    }
    if (backendRestoreInProgress || existsSync(recoveryMarker)) {
      console.warn("A database restore is still active or requires recovery; leaving the API running for administrator review.");
      return;
    }
  })();
  return shutdownPromise;
};

const parentPid = Number(process.env.FOOD_SYSTEM_PARENT_PID || 0);
if (parentPid > 0) {
  const parentMonitor = setInterval(() => {
    try {
      process.kill(parentPid, 0);
    } catch (error) {
      if (error.code === "ESRCH") shutdown();
    }
  }, 500);
  parentMonitor.unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
if (process.env.FOOD_SYSTEM_TAURI_CONTROL === "1") {
  let controlBuffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    controlBuffer += chunk;
    let newline;
    while ((newline = controlBuffer.indexOf("\n")) >= 0) {
      const line = controlBuffer.slice(0, newline);
      controlBuffer = controlBuffer.slice(newline + 1);
      try {
        if (JSON.parse(line)?.type === "shutdown") void shutdown();
      } catch {}
    }
  });
  process.stdin.on("end", () => void shutdown());
}

const publicBusinessIdPattern = "[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}";
const publicTableTokenPattern = /^[0-9a-f]{48}$/i;
const sendProxyError = (response, status, message) => {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify({ error: message }));
};

const allowPublicRequest = (request, limit) => {
  const now = Date.now();
  const key = request.socket.remoteAddress || "unknown";
  if (publicRequestAttempts.size >= 4000) {
    for (const [candidate, value] of publicRequestAttempts) {
      if (value.resetAt <= now) publicRequestAttempts.delete(candidate);
    }
  }
  let attempt = publicRequestAttempts.get(key);
  if (!attempt || attempt.resetAt <= now) attempt = { count: 0, resetAt: now + 60_000 };
  if (attempt.count >= limit) return false;
  if (!publicRequestAttempts.has(key) && publicRequestAttempts.size >= 5000) return false;
  attempt.count += 1;
  publicRequestAttempts.set(key, attempt);
  return true;
};

const handlePublicApi = async (request, response) => {
  let target;
  try { target = new URL(request.url, "http://127.0.0.1"); }
  catch { sendProxyError(response, 400, "Invalid API path"); return; }

  const menuByToken = request.method === "GET" && /^\/api\/v1\/menu\/[0-9a-f]{48}$/i.test(target.pathname);
  const publicMenu = request.method === "GET" && new RegExp(`^/api/v1/businesses/${publicBusinessIdPattern}/public$`, "i").test(target.pathname);
  const publicOrder = request.method === "POST" && new RegExp(`^/api/v1/businesses/${publicBusinessIdPattern}/orders$`, "i").test(target.pathname);
  const courierDeliveries = request.method === "GET" && target.pathname === "/api/v1/courier/deliveries";
  const courierDeliveryUpdate = request.method === "PATCH" && new RegExp(`^/api/v1/courier/deliveries/${publicBusinessIdPattern}$`, "i").test(target.pathname);
  const courierLocation = request.method === "POST" && target.pathname === "/api/v1/courier/location";
  const courierWrite = courierDeliveryUpdate || courierLocation;
  const health = request.method === "GET" && target.pathname === "/up";
  if (!(menuByToken || publicMenu || publicOrder || courierDeliveries || courierWrite || health)) {
    request.resume();
    sendProxyError(response, 404, "Public API route not available");
    return;
  }

  const requestLimit = publicOrder || courierWrite ? 60 : 120;
  if (!allowPublicRequest(request, requestLimit)) {
    response.setHeader("Retry-After", "60");
    sendProxyError(response, 429, requestLimit === 60 ? "Too many public updates from this address" : "Too many public reads from this address");
    return;
  }

  let body = Buffer.alloc(0);
  if (publicOrder || courierWrite) {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    const maxBodySize = publicOrder ? 64 * 1024 : 16 * 1024;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > maxBodySize) tooLarge = true;
      else chunks.push(chunk);
    }
    if (tooLarge) { sendProxyError(response, 413, publicOrder ? "Order request too large" : "Courier request too large"); return; }
    body = Buffer.concat(chunks);
    let payload;
    try { payload = JSON.parse(body.toString("utf8")); }
    catch { sendProxyError(response, 400, publicOrder ? "Invalid order request" : "Invalid courier request"); return; }
    if (publicOrder) {
      const tableToken = String(payload?.table_token || "");
      if (tableToken && !publicTableTokenPattern.test(tableToken)) {
        sendProxyError(response, 400, "Invalid table token");
        return;
      }
    } else if (courierDeliveryUpdate && !["picked_up", "delivered", "failed"].includes(payload?.status)) {
      sendProxyError(response, 400, "Invalid courier delivery status");
      return;
    }
    if (!/^(application\/json)(?:\s*;|$)/i.test(request.headers["content-type"] || "")) {
      sendProxyError(response, 415, "JSON content type required");
      return;
    }
    if (courierWrite && String(request.headers["x-courier-token"] || "").length > 256) {
      sendProxyError(response, 400, "Invalid courier token");
      return;
    }
  } else {
    request.resume();
  }

  const headers = { Accept: request.headers.accept || "application/json" };
  if (publicOrder || courierWrite) {
    headers["Content-Type"] = "application/json";
    headers["Content-Length"] = String(body.length);
  }
  if (courierDeliveries || courierWrite) {
    const courierToken = request.headers["x-courier-token"];
    if (typeof courierToken === "string") headers["X-Courier-Token"] = courierToken;
  }
  const upstream = createHttpRequest({
    hostname: "127.0.0.1",
    port: 3000,
    method: request.method,
    path: `${target.pathname}${target.search}`,
    headers,
  }, (upstreamResponse) => {
    response.writeHead(upstreamResponse.statusCode || 502, {
      "Content-Type": upstreamResponse.headers["content-type"] || "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...(frontendProtocol === "https" ? { "Strict-Transport-Security": "max-age=31536000" } : {}),
    });
    upstreamResponse.pipe(response);
  });
  let upstreamTimedOut = false;
  upstream.on("error", () => {
    if (upstreamTimedOut) return;
    if (!response.headersSent) sendProxyError(response, 502, "Local API unavailable");
    else response.destroy();
  });
  upstream.setTimeout(30_000, () => {
    upstreamTimedOut = true;
    if (!response.headersSent) sendProxyError(response, 504, "Local API response timed out");
    else response.destroy();
    upstream.destroy();
  });
  response.on("close", () => {
    if (!response.writableEnded) upstream.destroy();
  });
  upstream.end(body);
};

const handleFrontend = (request, response) => {
  try {
    const requestedPath = new URL(request.url || "/", "http://127.0.0.1").pathname;
    if (requestedPath === "/up" || requestedPath.startsWith("/api/v1/")) {
      void handlePublicApi(request, response).catch(() => {
        if (!response.headersSent) sendProxyError(response, 500, "Public API proxy failed");
        else response.destroy();
      });
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" });
      response.end();
      return;
    }
    const file = safePath(request.url);
    if (!file || !existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
    response.writeHead(200, {
      "Content-Type": contentTypes[extname(file)] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'self' http://127.0.0.1:3000 http://localhost:3000; connect-src 'self' http://127.0.0.1:3000 http://localhost:3000; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'",
      "Cache-Control": "no-store",
      ...(frontendProtocol === "https" ? { "Strict-Transport-Security": "max-age=31536000" } : {}),
    });
    createReadStream(file).pipe(response);
  } catch {
    response.writeHead(400);
    response.end("Bad request");
  }
};
frontend = tlsKeyPath && tlsCertPath
  ? createHttpsServer({ key: readFileSync(tlsKeyPath), cert: readFileSync(tlsCertPath) }, handleFrontend)
  : createHttpServer(handleFrontend);
frontend.headersTimeout = 15_000;
frontend.requestTimeout = 30_000;
frontend.timeout = 60_000;
frontend.keepAliveTimeout = 5_000;
const frontendProtocol = tlsKeyPath && tlsCertPath ? "https" : "http";

const backendEnv = {
  ...process.env,
  NODE_ENV: nodeEnvironment,
  FOOD_SYSTEM_LOCAL_ACCESS_TOKEN: localAccessToken,
  FOOD_SYSTEM_SECRET_KEY: secretKey,
  FOOD_SYSTEM_DATA_DIR: dataDir,
  FOOD_SYSTEM_BACKUP_DIR: join(dataDir, "backups"),
  FOOD_SYSTEM_ENV_FILE: environmentFile,
  HOST: "127.0.0.1",
};
migrationPromise = execFile(process.execPath, ["src/migrate.js"], {
  cwd: backendRoot,
  env: backendEnv,
  windowsHide: true,
});
try {
  await migrationPromise;
} catch (error) {
  if (shuttingDown) {
    await shutdown();
    process.exitCode = 0;
  } else {
    console.error("Food System database migration failed:", error.message);
    await shutdown();
    process.exitCode = 1;
    throw error;
  }
} finally {
  migrationPromise = null;
}
if (shuttingDown) {
  await shutdown();
  process.exit(0);
}
backend = spawn(process.execPath, ["src/server.js"], {
  cwd: backendRoot,
  stdio: ["ignore", "inherit", "inherit", "ipc"],
  env: backendEnv,
});
const apiListening = waitForApiListener(backend);
backend.on("message", (message) => {
  if (message?.type === "api-stopping") process.stdout.write("FOOD_SYSTEM_API_STOPPING\n");
  else if (message?.type === "restore-start") backendRestoreInProgress = true;
  else if (message?.type === "restore-end") backendRestoreInProgress = false;
  else if (message?.type === "restore-recovery-required") backendRestoreInProgress = true;
});
backend.on("error", (error) => {
  console.error("Food System could not start its API:", error.message);
  void shutdown().then(() => { process.exitCode = 1; }).catch((shutdownError) => console.error("Food System shutdown failed:", shutdownError.message));
});

backend.on("exit", (code) => {
  if (code && code !== 0) process.exitCode = code;
  void shutdown();
});

try {
  await apiListening;
} catch (error) {
  console.error("Food System could not bind its local API:", error.message);
  await shutdown();
  process.exitCode = 1;
  throw error;
}
process.stdout.write("FOOD_SYSTEM_API_LISTENING\n");

const waitForReadiness = async () => {
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:3000/api/v1/health");
      const payload = await response.json();
      if (response.ok && payload.database === "ok") {
        console.log("Food System database: ready");
        return;
      }
      if (attempt === 20) console.warn("Food System API started, but its local SQLite database is unavailable.");
    } catch {
      if (attempt === 20) console.warn("Food System API did not respond. Check port 3000 and the backend installation.");
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
};

frontend.listen(frontendPort, frontendHost, () => {
  console.log(`Food System frontend: ${frontendProtocol}://${frontendHost}:${frontendPort}`);
  console.log("Food System API: http://127.0.0.1:3000");
  void waitForReadiness();
});
frontend.on("error", (error) => {
  console.error("Food System could not start its frontend:", error.message);
  void shutdown().then(() => { process.exitCode = 1; }).catch((shutdownError) => console.error("Food System shutdown failed:", shutdownError.message));
});
