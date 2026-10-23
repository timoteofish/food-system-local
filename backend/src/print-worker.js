import "dotenv/config";
import { pool } from "./db.js";

const runOnce = async () => {
  const [jobs] = await pool.query("SELECT pj.id, pj.payload, ks.printer_url FROM print_jobs pj JOIN kitchen_stations ks ON ks.id = pj.station_id WHERE pj.status = 'queued' AND ks.active = TRUE AND ks.printer_url IS NOT NULL ORDER BY pj.created_at LIMIT 10");
  for (const job of jobs) {
    await pool.query("UPDATE print_jobs SET attempts = attempts + 1 WHERE id = ? AND status = 'queued'", [job.id]);
    try {
      const response = await fetch(job.printer_url, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: typeof job.payload === "string" ? job.payload : JSON.stringify(job.payload), signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(`Printer returned HTTP ${response.status}`);
      await pool.query("UPDATE print_jobs SET status = 'printed', printed_at = CURRENT_TIMESTAMP, error_message = NULL WHERE id = ? AND status = 'queued'", [job.id]);
    } catch (error) {
      await pool.query("UPDATE print_jobs SET status = CASE WHEN attempts >= 3 THEN 'failed' ELSE 'queued' END, error_message = ? WHERE id = ? AND status = 'queued'", [String(error.message || "Printer request failed").slice(0, 500), job.id]);
    }
  }
  return jobs.length;
};

if (process.env.PRINT_WORKER_ONCE === "true") {
  await runOnce();
  await pool.end();
} else {
  setInterval(() => void runOnce().catch((error) => console.error("Print worker error", error)), Number(process.env.PRINT_WORKER_INTERVAL_MS || 5000));
}

export { runOnce };
