import { getRepository } from "@/data/repository";

export type ReminderCatchUpStatus =
  | "not_needed"
  | "processed"
  | "paused"
  | "failed";

export interface ReminderCatchUpResult {
  attempted: boolean;
  status: ReminderCatchUpStatus;
  scheduledFor: string | null;
}

function workerStatus(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const status = Reflect.get(value, "status");
  return typeof status === "string" ? status : null;
}

/**
 * Newly eligible tenants can be created after this month's configured send
 * time. Process that already-due schedule immediately instead of waiting for
 * the next cron run. Provider and global pause settings remain authoritative.
 */
export async function attemptImmediateReminderCatchUp(
  tenantId: string
): Promise<ReminderCatchUpResult> {
  const repository = getRepository();
  const { schedule } = await repository.getTenant(tenantId);
  const scheduledFor = schedule?.nextRunAt ?? null;
  if (
    !schedule?.isEnabled
    || !scheduledFor
    || Date.parse(scheduledFor) > Date.now()
  ) {
    return { attempted: false, status: "not_needed", scheduledFor };
  }

  try {
    const result = await repository.runReminderWorker();
    if (workerStatus(result) === "paused") {
      return {
        attempted: true,
        status: "paused",
        scheduledFor
      };
    }
    const event = (await repository.listEvents({
      tenantId,
      scheduledFrom: scheduledFor,
      limit: 20
    })).find((candidate) =>
      candidate.source === "scheduled"
      && candidate.scheduledFor === scheduledFor
    );
    return {
      attempted: true,
      status: event && ["queued", "sent", "delivered"].includes(event.status)
        ? "processed"
        : "failed",
      scheduledFor
    };
  } catch {
    // Creating the tenant is the durable operation. A provider or worker
    // outage must not roll it back; the cron worker will retry the schedule.
    return { attempted: true, status: "failed", scheduledFor };
  }
}
