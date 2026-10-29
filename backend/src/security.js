import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { open } from "node:fs/promises";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const keySource = process.env.FOOD_SYSTEM_SECRET_KEY || "";
const key = keySource ? createHash("sha256").update(keySource).digest() : null;
const fileMagic = Buffer.from("FSS2", "ascii");

export const hasSecretKey = () => Boolean(key);

export const encryptSecret = (value) => {
  if (!key) throw new Error("FOOD_SYSTEM_SECRET_KEY is required");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  return `v1:${iv.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${encrypted.toString("base64url")}`;
};

export const decryptSecret = (value) => {
  if (!key) throw new Error("FOOD_SYSTEM_SECRET_KEY is required");
  const [version, ivText, tagText, dataText] = String(value || "").split(":");
  if (version !== "v1" || !ivText || !tagText || !dataText) throw new Error("Invalid encrypted secret");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(dataText, "base64url")), decipher.final()]).toString("utf8");
};

export const encryptFile = async (input, output) => {
  if (!key) throw new Error("FOOD_SYSTEM_SECRET_KEY is required");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const outputHandle = await open(output, "wx", 0o600);
  const encrypting = new Transform({
    transform(chunk, _encoding, callback) {
      try { callback(null, cipher.update(chunk)); }
      catch (error) { callback(error); }
    },
    flush(callback) {
      try { callback(null, Buffer.concat([cipher.final(), cipher.getAuthTag()])); }
      catch (error) { callback(error); }
    },
  });
  try {
    await outputHandle.writeFile(Buffer.concat([fileMagic, iv]));
    await pipeline(createReadStream(input), encrypting, outputHandle.createWriteStream());
  } catch (error) {
    await outputHandle.close().catch(() => {});
    throw error;
  }
};

const decryptLegacyFile = async (input, output) => {
  let header = "";
  let decipher = null;
  let carry = "";
  const decrypting = new Transform({
    transform(chunk, _encoding, callback) {
      try {
        let encoded = String(chunk);
        if (!decipher) {
          header += encoded;
          const first = header.indexOf(":");
          const second = header.indexOf(":", first + 1);
          const third = header.indexOf(":", second + 1);
          if (header.length > 256 && third < 0) throw new Error("Invalid encrypted secret header");
          if (first < 0 || second < 0 || third < 0) { callback(); return; }
          if (header.slice(0, first) !== "v1") throw new Error("Invalid encrypted secret");
          decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(header.slice(first + 1, second), "base64url"));
          decipher.setAuthTag(Buffer.from(header.slice(second + 1, third), "base64url"));
          encoded = header.slice(third + 1);
          header = "";
        }
        encoded = carry + encoded;
        const completeLength = encoded.length - (encoded.length % 4);
        if (completeLength > 0) this.push(decipher.update(Buffer.from(encoded.slice(0, completeLength), "base64url")));
        carry = encoded.slice(completeLength);
        callback();
      } catch (error) { callback(error); }
    },
    flush(callback) {
      try {
        if (!decipher || carry.length === 1) throw new Error("Invalid encrypted secret");
        if (carry) this.push(decipher.update(Buffer.from(carry, "base64url")));
        callback(null, decipher.final());
      } catch (error) { callback(error); }
    },
  });
  await pipeline(createReadStream(input, { encoding: "utf8" }), decrypting, createWriteStream(output, { flags: "wx", mode: 0o600 }));
};

export const decryptFile = async (input, output) => {
  if (!key) throw new Error("FOOD_SYSTEM_SECRET_KEY is required");
  const probe = Buffer.alloc(fileMagic.length);
  const { bytesRead } = await open(input, "r").then(async (handle) => {
    try { return await handle.read(probe, 0, probe.length, 0); }
    finally { await handle.close(); }
  });
  if (bytesRead !== fileMagic.length || !probe.equals(fileMagic)) {
    await decryptLegacyFile(input, output); // Stream legacy v1 backups for upgrade compatibility.
    return;
  }

  const header = Buffer.alloc(16);
  const headerRead = await open(input, "r").then(async (handle) => {
    try { return await handle.read(header, 0, header.length, 0); }
    finally { await handle.close(); }
  });
  if (headerRead.bytesRead !== header.length) throw new Error("Invalid encrypted backup header");
  const decipher = createDecipheriv("aes-256-gcm", key, header.subarray(4, 16));
  let pending = Buffer.alloc(0);
  const decrypting = new Transform({
    transform(chunk, _encoding, callback) {
      try {
        const combined = pending.length ? Buffer.concat([pending, chunk]) : chunk;
        const encryptedLength = Math.max(0, combined.length - 16);
        if (encryptedLength > 0) this.push(decipher.update(combined.subarray(0, encryptedLength)));
        pending = Buffer.from(combined.subarray(encryptedLength));
        callback();
      } catch (error) { callback(error); }
    },
    flush(callback) {
      try {
        if (pending.length !== 16) throw new Error("Invalid encrypted backup trailer");
        decipher.setAuthTag(pending);
        callback(null, decipher.final());
      } catch (error) { callback(error); }
    },
  });
  await pipeline(createReadStream(input, { start: header.length }), decrypting, createWriteStream(output, { flags: "wx", mode: 0o600 }));
};

export const redact = (value) => {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([name, item]) => {
    const sensitive = /password|secret|token|credential|certificate|private.?key/i.test(name);
    return [name, sensitive ? "[REDACTED]" : redact(item)];
  }));
};
