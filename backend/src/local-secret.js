import { randomBytes, randomUUID } from "node:crypto";
import { chmod, link, lstat, mkdir, open, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";

const readExistingKey = async (secretKeyPath) => {
  const info = await lstat(secretKeyPath);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("The local encryption key path must be a regular file.");
  if (process.platform !== "win32") await chmod(secretKeyPath, 0o600);
  return (await readFile(secretKeyPath, "utf8")).trim();
};

export const loadOrCreateLocalSecret = async ({ dataDir, backupDir }) => {
  dataDir = path.resolve(dataDir);
  backupDir = path.resolve(backupDir);
  const secretKeyPath = path.join(dataDir, "secret.key");
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") await chmod(dataDir, 0o700);

  let key;
  try {
    key = await readExistingKey(secretKeyPath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    let existingBackups = [];
    try {
      existingBackups = (await readdir(backupDir)).filter((name) => name.endsWith(".sqlite.enc"));
    } catch (readError) {
      if (readError.code !== "ENOENT") throw readError;
    }
    if (existingBackups.length) {
      throw new Error("Encrypted backups exist but the local encryption key is missing. Set FOOD_SYSTEM_SECRET_KEY or restore secret.key before starting.");
    }

    key = randomBytes(32).toString("base64url");
    const temporaryKeyPath = `${secretKeyPath}.${process.pid}.${randomUUID()}.tmp`;
    let created = false;
    try {
      const file = await open(temporaryKeyPath, "wx", 0o600);
      created = true;
      try {
        await file.writeFile(`${key}\n`);
        await file.sync();
      } finally { await file.close(); }
      try {
        await link(temporaryKeyPath, secretKeyPath);
      } catch (linkError) {
        if (linkError.code !== "EEXIST") throw linkError;
        key = await readExistingKey(secretKeyPath);
      }
    } finally {
      if (created) await rm(temporaryKeyPath, { force: true });
    }
  }

  if (key.length < 32) throw new Error("The local encryption key is missing or invalid. Restore secret.key or set FOOD_SYSTEM_SECRET_KEY.");
  return key;
};

export const ensureLocalSecretKey = async ({ backendRoot, projectRoot = path.resolve(backendRoot, "..") }) => {
  if (process.env.FOOD_SYSTEM_SECRET_KEY) {
    if (process.env.FOOD_SYSTEM_SECRET_KEY.length < 32) throw new Error("FOOD_SYSTEM_SECRET_KEY must contain at least 32 characters.");
    return process.env.FOOD_SYSTEM_SECRET_KEY;
  }
  if ((process.env.NODE_ENV || "development") === "production") {
    throw new Error("FOOD_SYSTEM_SECRET_KEY must be configured in production.");
  }
  const key = await loadOrCreateLocalSecret({
    dataDir: process.env.FOOD_SYSTEM_DATA_DIR || path.join(backendRoot, "state"),
    backupDir: process.env.FOOD_SYSTEM_BACKUP_DIR || path.join(projectRoot, "state", "backups"),
  });
  process.env.FOOD_SYSTEM_SECRET_KEY = key;
  return key;
};
