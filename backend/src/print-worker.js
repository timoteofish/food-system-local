import "./load-env.js";
import { requestPublicHttps } from "./outbound-request.js";
import { registerPrintWorker } from "./restore-coordination.js";

await registerPrintWorker();
const { pool } = await import("./db.js");

const runOnce = async () => {
  const [jobs] = await pool.query("SELECT pj.id, pj.payload, ks.printer_url FROM print_jobs pj JOIN kitchen_stations ks ON ks.id = pj.station_id WHERE pj.status = 'queued' AND ks.active = TRUE AND ks.printer_url IS NOT NULL ORDER BY pj.created_at LIMIT 10");
  for (const job of jobs) {
    // Claim before sending. If the process stops mid-request, leave the job failed:
    // retrying automatically could print the same ticket twice.
    const [claim] = await pool.query("UPDATE print_jobs SET status = 'failed', attempts = attempts + 1, error_message = 'Print outcome unknown; review before retrying' WHERE id = ? AND status = 'queued'", [job.id]);
    if (!claim.affectedRows) continue;
    try {
      const printerUrl = new URL(job.printer_url);
      const printerHost = printerUrl.hostname.replace(/^\[|\]$/g, "");
      const isLoopbackHttp = printerUrl.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(printerHost);
      if (printerUrl.username || printerUrl.password || (printerUrl.protocol !== "https:" && !isLoopbackHttp)) {
        throw new Error("Printer URL must use public HTTPS or loopback HTTP");
      }
      const payload = typeof job.payload === "string" ? job.payload : JSON.stringify(job.payload);
      let status;
      if (printerUrl.protocol === "https:") {
        status = await requestPublicHttps(printerUrl, { method: "POST", body: payload });
      } else {
        const response = await fetch(printerUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: payload,
          redirect: "error",
          signal: AbortSignal.timeout(10000),
        });
        status = response.status;
      }
      if (status < 200 || status >= 300) throw new Error(`Printer returned HTTP ${status}`);
      await pool.query("UPDATE print_jobs SET status = 'printed', printed_at = CURRENT_TIMESTAMP, error_message = NULL WHERE id = ? AND status = 'failed'", [job.id]);
    } catch (error) {
      await pool.query("UPDATE print_jobs SET status = 'failed', error_message = ? WHERE id = ? AND status = 'failed'", [String(error.message || "Printer request failed; review before retrying").slice(0, 500), job.id]);
    }
  }
  return jobs.length;
};

if (process.env.PRINT_WORKER_ONCE === "true") {
  await runOnce();
  await pool.end();
} else {
  const configuredInterval = Number(process.env.PRINT_WORKER_INTERVAL_MS || 5000);
  const interval = Number.isFinite(configuredInterval) && configuredInterval >= 1000 ? configuredInterval : 5000;
  const poll = async () => {
    try { await runOnce(); }
    catch (error) { console.error("Print worker error", error); }
    setTimeout(poll, interval);
  };
  void poll();
}

export { runOnce };
