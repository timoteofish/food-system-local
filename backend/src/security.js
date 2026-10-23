import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const keySource = process.env.FOOD_SYSTEM_SECRET_KEY || "";
const key = keySource ? createHash("sha256").update(keySource).digest() : null;

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

export const redact = (value) => {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([name, item]) => {
    const sensitive = /password|secret|token|credential|certificate|private.?key/i.test(name);
    return [name, sensitive ? "[REDACTED]" : redact(item)];
  }));
};
