import { createClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/api";

type CleanupJob = { file_id: string; storage_bucket: string; storage_path: string; attempts: number; lease_token: string };

function cleanupClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new ApiError(503, "APPLICATION_SERVICE_UNAVAILABLE", "File cleanup is not configured.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.any([
      ...(init?.signal ? [init.signal] : []), AbortSignal.timeout(10_000)
    ]) }) }
  });
}

export async function processApplicationFileCleanup(options: { fileId?: string; limit?: number } = {}) {
  const stats = { claimed: 0, completed: 0, failed: 0 };
  if (process.env.DATA_BACKEND !== "supabase") return stats;
  const service = cleanupClient();
  const claimed = await service.rpc("claim_application_file_cleanup", { p_limit: options.limit ?? 3, p_file_id: options.fileId ?? null });
  if (claimed.error) throw new Error("Application file cleanup queue could not be claimed.");
  const jobs = (claimed.data ?? []) as CleanupJob[];
  stats.claimed = jobs.length;
  // Bounded parallel requests keep the shared Cron within its request budget.
  for (let offset = 0; offset < jobs.length; offset += 3) {
    await Promise.all(jobs.slice(offset, offset + 3).map(async job => {
      try {
        const removed = await service.storage.from(job.storage_bucket).remove([job.storage_path]);
        if (removed.error) throw new Error("Storage deletion failed.");
        const completed = await service.from("application_file_cleanup_jobs").update({
          status: "completed", completed_at: new Date().toISOString(), storage_path: null, locked_until: null, lease_token: null
        }).eq("file_id", job.file_id).eq("lease_token", job.lease_token).select("file_id");
        if (completed.error || completed.data?.length !== 1) throw new Error("Cleanup completion could not be recorded.");
        stats.completed++;
      } catch {
        stats.failed++;
        // If this write also fails, the persisted lease expires and Cron reclaims
        // the same job. A repeated Storage remove safely retries the same key.
        try {
          await service.from("application_file_cleanup_jobs").update({
            next_attempt_at: new Date(Date.now() + Math.min(3600, 30 * 2 ** Math.min(job.attempts, 7)) * 1000).toISOString(),
            locked_until: null, lease_token: null
          }).eq("file_id", job.file_id).eq("lease_token", job.lease_token);
        } catch { /* The durable lease remains recoverable after process/network failure. */ }
        console.error(JSON.stringify({ level: "error", message: "Application file cleanup will retry", fileId: job.file_id }));
      }
    }));
  }
  return stats;
}
