import { randomUUID } from "node:crypto";
import { encryptSecret } from "./security.js";

export const migrateLegacyIntegrationCredentials = async (connection, encrypt = encryptSecret, makeId = randomUUID) => {
  const [columns] = await connection.query("SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'integration_connections' AND column_name = 'credentials' LIMIT 1");
  if (!columns.length) return;
  const [rows] = await connection.query("SELECT id, business_id, credentials FROM integration_connections WHERE credentials IS NOT NULL FOR UPDATE");
  for (const row of rows) {
    let credentials = row.credentials;
    if (typeof credentials === "string") {
      try { credentials = JSON.parse(credentials); }
      catch { throw new Error("Legacy integration credentials are invalid; migration stopped without dropping the source column"); }
    }
    if (!credentials || typeof credentials !== "object" || Array.isArray(credentials)) {
      throw new Error("Legacy integration credentials are invalid; migration stopped without dropping the source column");
    }
    if (!Object.keys(credentials).length) continue;
    const encryptedValue = encrypt(JSON.stringify(credentials));
    await connection.query(
      "INSERT INTO secure_secrets (id, business_id, secret_name, encrypted_value) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE encrypted_value = VALUES(encrypted_value), updated_at = CURRENT_TIMESTAMP",
      [makeId(), row.business_id, `integration:${row.id}`, encryptedValue],
    );
  }
};
