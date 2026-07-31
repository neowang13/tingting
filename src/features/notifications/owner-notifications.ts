import { Temporal } from "@js-temporal/polyfill";
import { getRepository } from "@/data/repository";
import {
  createNotificationProviders,
  resolveEmailProviderMode
} from "@/features/notifications/providers";
import type { EmailProvider } from "@/features/notifications/providers/types";
import { ApiError } from "@/lib/api";
import type {
  OwnerNotificationDelivery,
  Tenant,
  TenantActivitySummary
} from "@/lib/contracts";

const weekdayNames = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday"
] as const;

export interface OwnerNotificationWorkerSummary {
  claimed: number;
  sent: number;
  failed: number;
  skipped: number;
}

function ownerRecipient() {
  return process.env.OWNER_NOTIFICATION_TO_EMAIL
    ?? process.env.ALERT_TO_EMAIL
    ?? process.env.LOCAL_ADMIN_EMAIL
    ?? null;
}

function safeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function display(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function formatDateTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function tenantLine(tenant: Tenant, timezone: string) {
  const unit = tenant.unitLabel ? ` / ${tenant.unitLabel}` : "";
  return `${tenant.fullName} — ${tenant.propertyLabel}${unit} — ${formatDateTime(tenant.createdAt, timezone)}`;
}

function tenantUploadMessage(tenant: Tenant, timezone: string) {
  const fields: Array<[string, string | number | null | undefined]> = [
    ["姓名", tenant.fullName],
    ["房源", tenant.propertyLabel],
    ["单元", tenant.unitLabel],
    ["入住日期", tenant.moveInDate],
    ["每月租金日", `${tenant.rentDueDay} 日`],
    ["Email", tenant.email],
    ["电话", tenant.phoneE164],
    ["首选联系渠道", tenant.preferredChannels.join(", ") || null],
    ["Email 权限状态", tenant.emailContactStatus],
    ["短信权限状态", tenant.smsContactStatus],
    ["时区", tenant.timezone],
    ["Active", tenant.isActive ? "是" : "否"],
    ["上传完成时间", formatDateTime(tenant.createdAt, timezone)]
  ];
  const text = [
    "租客信息上传完成。",
    "",
    ...fields.map(([label, value]) => `${label}：${display(value)}`)
  ].join("\n");
  const rows = fields.map(([label, value]) =>
    `<tr><th align="left" style="padding:6px 12px 6px 0">${safeHtml(label)}</th>`
    + `<td style="padding:6px 0">${safeHtml(display(value))}</td></tr>`
  ).join("");
  return {
    subject: `租客信息上传完成：${tenant.fullName}`,
    text,
    html: `<h2>租客信息上传完成</h2><table>${rows}</table>`
  };
}

function tenantListText(tenants: Tenant[], total: number, timezone: string) {
  if (total === 0) return ["无"];
  const lines = tenants.map((tenant) => `- ${tenantLine(tenant, timezone)}`);
  if (total > tenants.length) lines.push(`- 另有 ${total - tenants.length} 位未在邮件中展开`);
  return lines;
}

function tenantListHtml(tenants: Tenant[], total: number, timezone: string) {
  if (total === 0) return "<p>无</p>";
  const items = tenants
    .map((tenant) => `<li>${safeHtml(tenantLine(tenant, timezone))}</li>`)
    .join("");
  const remainder = total > tenants.length
    ? `<li>另有 ${total - tenants.length} 位未在邮件中展开</li>`
    : "";
  return `<ul>${items}${remainder}</ul>`;
}

function weeklySummaryMessage(
  activity: TenantActivitySummary,
  payload: Record<string, unknown>,
  timezone: string
) {
  const generatedThrough = typeof payload.generatedThrough === "string"
    ? payload.generatedThrough
    : new Date().toISOString();
  const dateLabel = formatDateTime(generatedThrough, timezone);
  const periodLines = tenantListText(
    activity.periodNewTenants,
    activity.periodNewCount,
    timezone
  );
  const todayLines = tenantListText(
    activity.todayNewTenants,
    activity.todayNewCount,
    timezone
  );
  return {
    subject: `租客周报：${activity.activeCount} 位 Active 租客`,
    text: [
      `截至 ${dateLabel}`,
      "",
      `当前 Active 租客：${activity.activeCount} 位`,
      `过去 7 天新增：${activity.periodNewCount} 位`,
      ...periodLines,
      "",
      `今天新增：${activity.todayNewCount} 位`,
      ...todayLines
    ].join("\n"),
    html: [
      "<h2>租客周报</h2>",
      `<p>截至 ${safeHtml(dateLabel)}</p>`,
      `<p><strong>当前 Active 租客：</strong>${activity.activeCount} 位</p>`,
      `<h3>过去 7 天新增：${activity.periodNewCount} 位</h3>`,
      tenantListHtml(activity.periodNewTenants, activity.periodNewCount, timezone),
      `<h3>今天新增：${activity.todayNewCount} 位</h3>`,
      tenantListHtml(activity.todayNewTenants, activity.todayNewCount, timezone)
    ].join("")
  };
}

function requiredPayloadTimestamp(
  delivery: OwnerNotificationDelivery,
  key: "periodStart" | "periodEnd" | "todayStart" | "generatedThrough"
) {
  const value = delivery.payload[key];
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new ApiError(500, "OWNER_NOTIFICATION_PAYLOAD_INVALID", "Owner notification payload is invalid.");
  }
  return value;
}

async function renderDelivery(delivery: OwnerNotificationDelivery, timezone: string) {
  const repository = getRepository();
  if (delivery.kind === "tenant_upload") {
    if (!delivery.tenantId) {
      throw new ApiError(500, "OWNER_NOTIFICATION_TENANT_MISSING", "Owner notification tenant is missing.");
    }
    const { tenant } = await repository.getTenant(delivery.tenantId);
    return tenantUploadMessage(tenant, timezone);
  }
  const periodStart = requiredPayloadTimestamp(delivery, "periodStart");
  const periodEnd = requiredPayloadTimestamp(delivery, "periodEnd");
  const todayStart = requiredPayloadTimestamp(delivery, "todayStart");
  const generatedThrough = requiredPayloadTimestamp(delivery, "generatedThrough");
  const activity = await repository.tenantActivitySummary({
    periodStart,
    periodEnd,
    todayStart,
    now: generatedThrough
  });
  return weeklySummaryMessage(activity, delivery.payload, timezone);
}

function retryAt(now: Date, attemptCount: number) {
  if (attemptCount >= 5) return null;
  const delayMinutes = Math.min(5 * (2 ** Math.max(0, attemptCount - 1)), 360);
  return new Date(now.getTime() + delayMinutes * 60_000).toISOString();
}

export async function enqueueTenantUploadNotification(tenant: Tenant) {
  return getRepository().enqueueOwnerNotification({
    notificationKey: `tenant-upload:${tenant.id}`,
    kind: "tenant_upload",
    tenantId: tenant.id,
    payload: { uploadedAt: tenant.createdAt },
    scheduledFor: new Date().toISOString()
  });
}

export function latestWeeklySummaryWindow(now = new Date()) {
  const timezone = process.env.DEFAULT_TIMEZONE ?? "America/Vancouver";
  const weekday = Number(process.env.OWNER_WEEKLY_SUMMARY_DAY ?? "1");
  const localTime = Temporal.PlainTime.from(process.env.OWNER_WEEKLY_SUMMARY_TIME ?? "09:00");
  const instant = Temporal.Instant.from(now.toISOString());
  const localNow = instant.toZonedDateTimeISO(timezone);
  const targetWeekday = Number.isInteger(weekday) && weekday >= 1 && weekday <= 7 ? weekday : 1;
  let scheduledDate = localNow.toPlainDate().subtract({
    days: (localNow.dayOfWeek - targetWeekday + 7) % 7
  });
  let scheduled = Temporal.ZonedDateTime.from({
    timeZone: timezone,
    year: scheduledDate.year,
    month: scheduledDate.month,
    day: scheduledDate.day,
    hour: localTime.hour,
    minute: localTime.minute
  }, { disambiguation: "earlier" });
  if (Temporal.Instant.compare(scheduled.toInstant(), instant) > 0) {
    scheduledDate = scheduledDate.subtract({ days: 7 });
    scheduled = Temporal.ZonedDateTime.from({
      timeZone: timezone,
      year: scheduledDate.year,
      month: scheduledDate.month,
      day: scheduledDate.day,
      hour: localTime.hour,
      minute: localTime.minute
    }, { disambiguation: "earlier" });
  }
  return {
    timezone,
    weekday: weekdayNames[targetWeekday - 1],
    scheduledFor: scheduled.toInstant().toString(),
    periodStart: localNow.subtract({ days: 7 }).toInstant().toString(),
    periodEnd: instant.toString(),
    todayStart: localNow.startOfDay().toInstant().toString(),
    generatedThrough: instant.toString()
  };
}

export async function enqueueWeeklyTenantSummary(now = new Date()) {
  if (!ownerRecipient() || resolveEmailProviderMode() === "disabled") {
    return { queued: false, reason: "email_not_configured" as const };
  }
  const window = latestWeeklySummaryWindow(now);
  const deliveryId = await getRepository().enqueueOwnerNotification({
    notificationKey: `weekly-tenant-summary:${window.scheduledFor}`,
    kind: "weekly_tenant_summary",
    tenantId: null,
    payload: {
      periodStart: window.periodStart,
      periodEnd: window.periodEnd,
      todayStart: window.todayStart,
      generatedThrough: window.generatedThrough
    },
    scheduledFor: window.scheduledFor
  });
  return { queued: true, deliveryId, scheduledFor: window.scheduledFor };
}

export async function deliverOwnerNotifications(options: {
  now?: Date;
  limit?: number;
  provider?: EmailProvider;
} = {}): Promise<OwnerNotificationWorkerSummary> {
  const now = options.now ?? new Date();
  const recipient = ownerRecipient();
  const mode = resolveEmailProviderMode();
  if (!recipient || mode === "disabled") {
    return { claimed: 0, sent: 0, failed: 0, skipped: 1 };
  }
  const repository = getRepository();
  const provider = options.provider
    ?? createNotificationProviders({ email: mode, sms: "disabled" }).email;
  const deliveries = await repository.claimOwnerNotifications(
    now.toISOString(),
    Math.min(Math.max(options.limit ?? 10, 1), 25)
  );
  const summary = { claimed: deliveries.length, sent: 0, failed: 0, skipped: 0 };
  const timezone = process.env.DEFAULT_TIMEZONE ?? "America/Vancouver";
  for (const delivery of deliveries) {
    try {
      const message = await renderDelivery(delivery, timezone);
      const result = await provider.send({
        to: recipient,
        ...message,
        idempotencyKey: `owner-notification:${delivery.notificationKey}`
      });
      await repository.finishOwnerNotification(delivery.id, {
        status: "sent",
        providerMessageId: result.providerMessageId,
        safeErrorCode: null,
        nextAttemptAt: null
      });
      summary.sent += 1;
    } catch (error) {
      await repository.finishOwnerNotification(delivery.id, {
        status: "failed",
        providerMessageId: null,
        safeErrorCode: error instanceof ApiError ? error.code : "OWNER_EMAIL_DELIVERY_FAILED",
        nextAttemptAt: retryAt(now, delivery.attemptCount)
      });
      summary.failed += 1;
    }
  }
  return summary;
}
