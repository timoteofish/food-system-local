import { spawn } from "node:child_process";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const frontendRoot = join(root, "frontend");
const backendRoot = join(root, "backend");
const frontendPort = Number(process.env.FRONTEND_PORT || 4173);

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
  return file.startsWith(frontendRoot) ? file : null;
};

const frontend = createServer((request, response) => {
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
});

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
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
backend.on("exit", (code) => {
  if (code && code !== 0) process.exitCode = code;
  frontend.close();
});

frontend.listen(frontendPort, "127.0.0.1", () => {
  console.log(`Food System frontend: http://127.0.0.1:${frontendPort}`);
  console.log("Food System API: http://127.0.0.1:3000");
  void waitForReadiness();
});
