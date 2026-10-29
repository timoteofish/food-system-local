import { createHash, verify } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const [rawUrl, rawSha256, rawSignature, rawPublicKey, rawOutput] = process.argv.slice(2);
if (!rawUrl || !rawSha256 || !rawSignature || !rawPublicKey || !rawOutput) {
  throw new Error("Uso: node desktop/download-update.mjs https://... sha256 assinatura-base64 chave-publica-PEM arquivo-de-saida");
}
const expected = String(rawSha256).trim().toLowerCase();
if (!/^[a-f0-9]{64}$/.test(expected)) throw new Error("SHA-256 esperado deve conter 64 caracteres hexadecimais");
let signature;
try { signature = Buffer.from(String(rawSignature), "base64"); } catch { throw new Error("Assinatura da atualização inválida"); }
if (!signature.length) throw new Error("Assinatura da atualização vazia");

const output = resolve(rawOutput);
const temporary = `${output}.download-${process.pid}-${Date.now()}`;
const MAX_UPDATE_BYTES = 1024 * 1024 * 1024;
await mkdir(dirname(output), { recursive: true });

const fetchHttps = async (url, redirects = 0) => {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash) throw new Error("Atualizações devem usar HTTPS sem credenciais ou fragmentos na URL");
  const response = await fetch(parsed, { redirect: "manual", signal: AbortSignal.timeout(120000) });
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    if (redirects >= 3) throw new Error("Muitos redirecionamentos no download da atualização");
    const location = response.headers.get("location");
    if (!location) throw new Error("Redirecionamento sem destino");
    return fetchHttps(new URL(location, parsed).toString(), redirects + 1);
  }
  if (!response.ok || !response.body) throw new Error(`Download da atualização falhou: HTTP ${response.status}`);
  return response;
};

const digest = createHash("sha256");
let downloadedBytes = 0;
const hashingStream = new Transform({
  transform(chunk, _encoding, callback) {
    downloadedBytes += chunk.length;
    if (downloadedBytes > MAX_UPDATE_BYTES) callback(new Error("O pacote de atualização excede o limite de 1 GiB"));
    else {
      digest.update(chunk);
      callback(null, chunk);
    }
  },
});

try {
  const response = await fetchHttps(rawUrl);
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_UPDATE_BYTES) throw new Error("O pacote de atualização excede o limite de 1 GiB");
  await pipeline(Readable.fromWeb(response.body), hashingStream, createWriteStream(temporary, { flags: "wx" }));
  const actual = digest.digest("hex");
  if (actual !== expected) throw new Error(`SHA-256 divergente: esperado ${expected}, recebido ${actual}`);
  if (!verify(null, Buffer.from(expected, "utf8"), String(rawPublicKey), signature)) throw new Error("Assinatura da atualização inválida");
  await rename(temporary, output);
  console.log(`Atualização verificada e gravada em ${output}`);
} catch (error) {
  await rm(temporary, { force: true });
  throw error;
}
