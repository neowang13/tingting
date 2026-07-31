import { handleApiError, ok, ApiError } from "@/lib/api";
import { isDemoMode } from "@/lib/auth";
import { getRepository } from "@/data/repository";
import { deliverOperationalAlerts } from "@/features/operations/alerts";
import {
  deliverOwnerNotifications,
  enqueueWeeklyTenantSummary
} from "@/features/notifications/owner-notifications";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const expected = process.env.REMINDER_CRON_SECRET;
    const actual = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    const demoAuthorized = isDemoMode() && actual === "demo-cron-secret";
    if ((!expected || actual !== expected) && !demoAuthorized) {
      throw new ApiError(401, "INVALID_CRON_SECRET", "The Cron secret is invalid.");
    }
    const repository = getRepository();
    const before = await repository.dashboard();
    const forcePaused = process.env.REMINDERS_FORCE_PAUSED !== "false";
    const effectiveWarnings = forcePaused
      ? before.warnings.filter((warning) => !warning.includes("15 minutes"))
      : before.warnings;
    const alertsBeforeRun = await deliverOperationalAlerts(effectiveWarnings, requestId);
    const worker = await repository.runReminderWorker();
    const maintenance = await repository.runDailyMaintenance();
    const weeklyTenantSummary = await enqueueWeeklyTenantSummary()
      .catch(() => ({ queued: false, reason: "queue_error" as const }));
    const ownerNotifications = await deliverOwnerNotifications()
      .catch(() => ({ claimed: 0, sent: 0, failed: 1, skipped: 0 }));
    const after = await repository.dashboard();
    const alertsAfterRun = await deliverOperationalAlerts(
      forcePaused ? after.warnings.filter((warning) => !warning.includes("15 minutes")) : after.warnings,
      requestId
    );
    return ok({
      worker,
      maintenance,
      weeklyTenantSummary,
      ownerNotifications,
      alertsBeforeRun,
      alertsAfterRun
    }, requestId);
  } catch (error) {
    return handleApiError(error, requestId);
  }
}
