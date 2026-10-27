import { execFile as execFileCallback, spawn } from "node:child_process";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import net from "node:net";
import { extname, isAbsolute, join, normalize, relative as relativePath, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const frontendRoot = join(root, "frontend");
const backendRoot = join(root, "backend");
const configuredMariaRoot = process.env.MARIADB_ROOT || "";
const mariaRoots = [configuredMariaRoot, "C:\\Program Files\\MariaDB 13.0", "C:\\Program Files\\MariaDB 11.0"].filter(Boolean);
const mariaRoot = mariaRoots.find((candidate) => existsSync(join(candidate, "bin", "mariadbd.exe"))) || mariaRoots[0];
const mariaServer = join(mariaRoot, "bin", "mariadbd.exe");
const mariaDefaults = join(mariaRoot, "data", "my.ini");
const frontendPort = Number(process.env.FRONTEND_PORT || 4173);
const frontendHost = process.env.FRONTEND_HOST || "127.0.0.1";
const tlsKeyPath = process.env.FRONTEND_TLS_KEY || "";
const tlsCertPath = process.env.FRONTEND_TLS_CERT || "";
if (!["127.0.0.1", "localhost", "::1"].includes(frontendHost) && (!tlsKeyPath || !tlsCertPath)) {
  throw new Error("FRONTEND_TLS_KEY and FRONTEND_TLS_CERT are required when the cardapio is exposed on the network");
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

const canConnectDatabase = () => new Promise((resolveConnection) => {
  const socket = net.createConnection({ host: "127.0.0.1", port: 3306 });
  const finish = (value) => { socket.destroy(); resolveConnection(value); };
  socket.once("connect", () => finish(true));
  socket.once("error", () => finish(false));
  socket.setTimeout(500, () => finish(false));
});

let startedDatabase = null;
const ensureDatabase = async () => {
  if (await canConnectDatabase()) return;
  if (!existsSync(mariaServer) || !existsSync(mariaDefaults)) {
    console.warn("MariaDB não encontrado. Configure MARIADB_ROOT ou instale MariaDB 13.0.");
    return;
  }
  startedDatabase = spawn(mariaServer, [`--defaults-file=${mariaDefaults}`, "--console"], {
    cwd: mariaRoot,
    stdio: "ignore",
    windowsHide: true,
  });
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await canConnectDatabase()) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  console.warn("MariaDB foi iniciado, mas não aceitou conexões a tempo.");
};

const handleFrontend = (request, response) => {
  try {
    const file = safePath(request.url);
    if (!file || !existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
    response.writeHead(200, { "Content-Type": contentTypes[extname(file)] || "application/octet-stream" });
    createReadStream(file).pipe(response);
  } catch {
    response.writeHead(400);
    response.end("Bad request");
  }
};
const frontend = tlsKeyPath && tlsCertPath
  ? createHttpsServer({ key: readFileSync(tlsKeyPath), cert: readFileSync(tlsCertPath) }, handleFrontend)
  : createHttpServer(handleFrontend);
const frontendProtocol = tlsKeyPath && tlsCertPath ? "https" : "http";

await ensureDatabase();
try {
  await execFile(process.execPath, ["src/migrate.js"], {
    cwd: backendRoot,
    env: process.env,
    windowsHide: true,
  });
} catch (error) {
  console.error("Food System database migration failed:", error.message);
  process.exitCode = 1;
  throw error;
}
const backend = spawn(process.execPath, ["src/server.js"], {
  cwd: backendRoot,
  stdio: "inherit",
  env: process.env,
});

const waitForReadiness = async () => {
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:3000/api/v1/health");
      const payload = await response.json();
      if (response.ok && payload.database === "ok") {
        console.log("Food System banco de dados: pronto");
        return;
      }
      if (attempt === 20) console.warn("Food System API iniciou, mas o banco não está disponível. Verifique o MariaDB e as variáveis MYSQL_*.");
    } catch {
      if (attempt === 20) console.warn("Food System API não respondeu. Verifique a porta 3000 e a instalação do backend.");
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
};

const shutdown = () => {
  frontend.close();
  if (!backend.killed) backend.kill();
  if (startedDatabase && !startedDatabase.killed) startedDatabase.kill();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
backend.on("exit", (code) => {
  if (code && code !== 0) process.exitCode = code;
  frontend.close();
});

frontend.listen(frontendPort, frontendHost, () => {
  console.log(`Food System frontend: ${frontendProtocol}://${frontendHost}:${frontendPort}`);
  console.log("Food System API: http://127.0.0.1:3000");
  void waitForReadiness();
});
