import { getRepository } from "@/data/repository";
import { createNotificationProviders, resolveNotificationProviderMode } from "@/features/notifications/providers";
import { ApiError } from "@/lib/api";

export interface OperationalAlertDeliverySummary {
  considered: number;
  sent: number;
  failed: number;
  skipped: number;
}

function alertCode(message: string) {
  if (message.includes("15 minutes")) return "scheduler_stale";
  if (message.includes("24-hour")) return "outbox_older_than_grace";
  if (message.includes("provider attempts")) return "repeated_provider_failures";
  if (message.includes("reconciliation")) return "reconciliation_gap";
  return "operational_warning";
}

function bucketStart(code: string, date = new Date()) {
  if (code === "reconciliation_gap") {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())).toISOString();
  }
  date.setUTCMinutes(0, 0, 0);
  return date.toISOString();
}

function safeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export async function deliverOperationalAlerts(
  warnings: string[],
  requestId: string
): Promise<OperationalAlertDeliverySummary> {
  const uniqueWarnings = [...new Set(warnings)];
  const summary = { considered: uniqueWarnings.length, sent: 0, failed: 0, skipped: 0 };
  const recipient = process.env.ALERT_TO_EMAIL;
  const mode = resolveNotificationProviderMode();
  if (!recipient || mode === "disabled") {
    summary.skipped = uniqueWarnings.length;
    return summary;
  }

  const repository = getRepository();
  const provider = createNotificationProviders(mode).email;
  for (const warning of uniqueWarnings) {
    const code = alertCode(warning);
    const bucket = bucketStart(code);
    const deliveryId = await repository.claimOperationalAlert(code, bucket, warning);
    if (!deliveryId) {
      summary.skipped += 1;
      continue;
    }
    try {
      const result = await provider.send({
        to: recipient,
        subject: `Ting Ting admin alert: ${code.replaceAll("_", " ")}`,
        text: `${warning}\n\nRequest/job ID: ${requestId}`,
        html: `<p>${safeHtml(warning)}</p><p>Request/job ID: ${safeHtml(requestId)}</p>`,
        idempotencyKey: `operational-alert:${code}:${bucket}`
      });
      await repository.finishOperationalAlert(deliveryId, "sent", result.providerMessageId, null);
      summary.sent += 1;
    } catch (error) {
      const safeErrorCode = error instanceof ApiError ? error.code : "ALERT_PROVIDER_ERROR";
      await repository.finishOperationalAlert(deliveryId, "failed", null, safeErrorCode);
      summary.failed += 1;
    }
  }
  return summary;
}
