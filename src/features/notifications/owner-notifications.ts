import { Temporal } from "@js-temporal/polyfill";
import { getRepository } from "@/data/repository";
import {
  createNotificationProviders,
  resolveEmailProviderMode
} from "@/features/notifications/providers";
import type { EmailProvider } from "@/features/notifications/providers/types";
import { ApiError } from "@/lib/api";
import {
  isOwnerDailyOverdueEnabled,
  isOwnerWeeklySummaryEnabled
} from "@/lib/env";
import type {
  OwnerNotificationDelivery,
  RentPaymentDetail,
  RentReportSnapshot,
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
    ["租约类型", tenant.leaseType === "fixed_term"
      ? "Fixed contract"
      : tenant.leaseType === "month_to_month"
        ? "Month to month"
        : "Needs lease details"],
    ["租约开始日", tenant.moveInDate],
    ["租约结束日", tenant.leaseEndDate],
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

function weeklySummaryMessage(
  activity: TenantActivitySummary,
  rent: RentReportSnapshot,
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
  const paymentLine = (detail: RentPaymentDetail) => {
    const unit = detail.tenant.unitLabel ? ` / ${detail.tenant.unitLabel}` : "";
    return `${detail.tenant.fullName} — ${detail.tenant.propertyLabel}${unit} — ${periodName(detail.payment.paymentPeriod)} — 到期 ${detail.payment.dueDate}`;
  };
  const paymentText = (details: RentPaymentDetail[]) =>
    details.length ? details.map((detail) => `- ${paymentLine(detail)}`) : ["- 无"];
  const paymentHtml = (details: RentPaymentDetail[]) =>
    `<ul style="margin:8px 0 0;padding-left:20px">${details.length
      ? details.map((detail) => `<li style="margin:6px 0">${safeHtml(paymentLine(detail))}</li>`).join("")
      : "<li>无</li>"
    }</ul>`;
  const collectionLine = (detail: RentPaymentDetail) =>
    `${paymentLine(detail)} — 收到 ${detail.payment.collectedAt
      ? formatDateTime(detail.payment.collectedAt, timezone)
      : "时间未记录"}`;
  const collectionText = rent.recentCollections.length
    ? rent.recentCollections.map((detail) => `- ${collectionLine(detail)}`)
    : ["- 无"];
  const collectionHtml = `<ul style="margin:8px 0 0;padding-left:20px">${rent.recentCollections.length
    ? rent.recentCollections.map((detail) =>
        `<li style="margin:6px 0">${safeHtml(collectionLine(detail))}</li>`
      ).join("")
    : "<li>无</li>"
  }</ul>`;
  const leaseLine = (detail: RentReportSnapshot["leases"]["expiringWithin30Days"][number]) =>
    `${detail.tenant.fullName} — ${detail.tenant.propertyLabel}${detail.tenant.unitLabel ? ` / ${detail.tenant.unitLabel}` : ""} — ${detail.tenant.moveInDate} 至 ${detail.tenant.leaseEndDate} — 剩余 ${detail.daysRemaining} 天`;
  const leaseHtml = (details: typeof rent.leases.expiringWithin30Days) =>
    `<ul style="margin:8px 0 0;padding-left:20px">${details.length
      ? details.map((detail) => `<li style="margin:6px 0">${safeHtml(leaseLine(detail))}</li>`).join("")
      : "<li>无</li>"
    }</ul>`;
  const overdueText = rent.overdue.length
    ? rent.overdue.map((detail) => `- ${paymentLine(detail)} — 逾期 ${detail.daysOverdue} 天`)
    : ["- 无"];
  const overdueHtml = `<ul style="margin:8px 0 0;padding-left:20px">${rent.overdue.length
    ? rent.overdue.map((detail) =>
        `<li style="margin:6px 0">${safeHtml(paymentLine(detail))} — 逾期 ${detail.daysOverdue} 天</li>`
      ).join("")
    : "<li>无</li>"
  }</ul>`;
  const subject = `婷婷租务周报｜本周应收 ${rent.thisWeek.due.length} · 已收 ${rent.thisWeek.collected.length} · 还差 ${rent.thisWeek.outstanding.length}`;
  const weekEndInclusive = Temporal.PlainDate.from(rent.weekEnd).subtract({ days: 1 }).toString();
  const text = [
    "TING TING REAL ESTATE",
    "Weekly rental overview",
    `${rent.weekStart} 至 ${weekEndInclusive}（${timezone}）`,
    `生成时间：${dateLabel}`,
    "",
    `本周应收：${rent.thisWeek.due.length}`,
    `本周已收：${rent.thisWeek.collected.length}`,
    `本周还差：${rent.thisWeek.outstanding.length}`,
    "",
    "本周已收",
    ...paymentText(rent.thisWeek.collected),
    "",
    "本周未收",
    ...paymentText(rent.thisWeek.outstanding),
    "",
    "本周收款活动（包含补收往期）",
    ...collectionText,
    "",
    `下周应收：${rent.nextWeek.due.length}`,
    `已提前收到：${rent.nextWeek.collectedEarly.length}`,
    ...paymentText(rent.nextWeek.collectedEarly),
    `下周待收：${rent.nextWeek.outstanding.length}`,
    ...paymentText(rent.nextWeek.outstanding),
    "",
    `逾期未收：${rent.overdue.length}`,
    ...overdueText,
    "",
    `当前 Active：${activity.activeCount}`,
    `过去 7 天新增：${activity.periodNewCount}`,
    ...periodLines,
    `今天新增：${activity.todayNewCount}`,
    ...todayLines,
    "",
    `Month to month：${rent.leases.monthToMonthCount}`,
    `未来 7 天到期 Fixed contract：${rent.leases.expiringWithin7Days.length}`,
    `未来 30 天到期 Fixed contract：${rent.leases.expiringWithin30Days.length}`,
    ...rent.leases.expiringWithin30Days.map((detail) => `- ${leaseLine(detail)}`),
    `已过期但仍 Active：${rent.leases.expiredActive.length}`,
    ...rent.leases.expiredActive.map((detail) => `- ${leaseLine(detail)}`),
    "",
    "This is an automated weekly summary from Ting Ting Admin."
  ].join("\n");
  const card = (label: string, value: number, color = "#2F6F5E") =>
    `<td class="summary-card" style="background:#fff;border:1px solid #E4E0DA;border-radius:12px;padding:16px;text-align:center;width:33%"><div style="color:#6B6F6D;font-size:12px;font-weight:600;text-transform:uppercase">${safeHtml(label)}</div><div style="color:${color};font-size:30px;font-weight:700;font-variant-numeric:tabular-nums">${value}</div></td>`;
  const section = (title: string, body: string) =>
    `<section style="background:#fff;border:1px solid #E4E0DA;border-radius:12px;margin-top:16px;padding:20px"><h2 style="color:#1F2321;font-size:18px;margin:0 0 8px">${safeHtml(title)}</h2>${body}</section>`;
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>@media only screen and (max-width:620px){.summary-row,.summary-card{display:block!important;width:auto!important}.summary-card{margin:8px 0!important}}</style></head><body style="background:#F6F4EF;color:#1F2321;font-family:'IBM Plex Sans','Segoe UI',sans-serif;margin:0;padding:24px"><main style="margin:0 auto;max-width:600px"><header style="background:#1C2B28;border-radius:14px;color:#fff;padding:24px"><div style="font-size:12px;font-weight:700;letter-spacing:.12em">TING TING REAL ESTATE</div><h1 style="font-size:26px;margin:8px 0">Weekly rental overview</h1><p style="color:#FFFFFF;margin:0">${rent.weekStart} 至 ${weekEndInclusive}<br>${safeHtml(dateLabel)} · ${safeHtml(timezone)}</p></header><table role="presentation" style="border-collapse:separate;border-spacing:8px;margin:12px -8px 0;width:calc(100% + 16px)"><tr class="summary-row">${card("本周应收", rent.thisWeek.due.length)}${card("本周已收", rent.thisWeek.collected.length)}${card("本周还差", rent.thisWeek.outstanding.length, "#A6720A")}</tr></table>${section("本周收款", `<h3 style="font-size:14px;margin:0">已收</h3>${paymentHtml(rent.thisWeek.collected)}<h3 style="font-size:14px;margin:16px 0 0">未收</h3>${paymentHtml(rent.thisWeek.outstanding)}`)}${section("本周收款活动（包含补收往期）", collectionHtml)}${section("下周到期", `<p style="margin:0">应收 <strong>${rent.nextWeek.due.length}</strong> · 已提前收到 <strong>${rent.nextWeek.collectedEarly.length}</strong> · 待收 <strong style="color:#A6720A">${rent.nextWeek.outstanding.length}</strong></p><h3 style="font-size:14px;margin:16px 0 0">已提前收到</h3>${paymentHtml(rent.nextWeek.collectedEarly)}<h3 style="font-size:14px;margin:16px 0 0">待收</h3>${paymentHtml(rent.nextWeek.outstanding)}`)}${section("逾期未收", `<p style="margin:0">当前仍有 <strong style="color:#B3411F">${rent.overdue.length}</strong> 份逾期账期。未解决记录将继续每天通过 Email 和 Agent 提醒。</p>${overdueHtml}`)}${section("租客动态", `<p style="margin:0">当前 Active <strong>${activity.activeCount}</strong> · 过去 7 天新增 <strong>${activity.periodNewCount}</strong> · 今天新增 <strong>${activity.todayNewCount}</strong></p>`)}${section("固定租约即将到期", `<p style="margin:0">Month to month <strong>${rent.leases.monthToMonthCount}</strong> · 未来 7 天 <strong style="color:#A6720A">${rent.leases.expiringWithin7Days.length}</strong> · 未来 30 天 <strong>${rent.leases.expiringWithin30Days.length}</strong></p>${leaseHtml(rent.leases.expiringWithin30Days)}${rent.leases.expiredActive.length ? `<h3 style="color:#B3411F;font-size:14px;margin:16px 0 0">需要核对：已过期但仍 Active</h3>${leaseHtml(rent.leases.expiredActive)}` : ""}`)}<footer style="color:#6B6F6D;font-size:12px;padding:20px 4px;text-align:center">This is an automated weekly summary from Ting Ting Admin.<br>${safeHtml(timezone)} · ${safeHtml(dateLabel)}</footer></main></body></html>`;
  return {
    subject,
    text,
    html
  };
}

function periodName(value: string) {
  return Temporal.PlainDate.from(value).toLocaleString("zh-CN", {
    year: "numeric",
    month: "long"
  });
}

function dailyOverdueMessage(rent: RentReportSnapshot) {
  const earliest = rent.overdue[0];
  const longest = rent.overdue.reduce(
    (maximum, detail) => Math.max(maximum, detail.daysOverdue),
    0
  );
  const line = (detail: RentReportSnapshot["overdue"][number]) =>
    `${detail.tenant.fullName} — ${detail.tenant.propertyLabel}${detail.tenant.unitLabel ? ` / ${detail.tenant.unitLabel}` : ""} — ${periodName(detail.payment.paymentPeriod)} — 到期 ${detail.payment.dueDate} — 逾期 ${detail.daysOverdue} 天`;
  return {
    subject: `逾期租金提醒｜${rent.overdue.length} 份租金仍未收到`,
    text: [
      `当前逾期：${rent.overdue.length} 份`,
      `最早到期日：${earliest?.payment.dueDate ?? "—"}`,
      `最长逾期：${longest} 天`,
      "",
      ...rent.overdue.map((detail) => `- ${line(detail)}`),
      "",
      "上传有效收款凭证并标记已收后，该账期会自动停止每日提醒。"
    ].join("\n"),
    html: `<div style="background:#F6F4EF;padding:24px;font-family:'IBM Plex Sans','Segoe UI',sans-serif"><main style="background:#fff;border:1px solid #E4E0DA;border-radius:14px;margin:auto;max-width:600px;padding:24px"><div style="color:#B3411F;font-size:12px;font-weight:700;letter-spacing:.08em">OVERDUE RENT</div><h1 style="font-size:24px;margin:8px 0">仍有 ${rent.overdue.length} 份租金未收到</h1><p>最早到期 ${earliest?.payment.dueDate ?? "—"} · 最长逾期 ${longest} 天</p><ul style="padding-left:20px">${rent.overdue.map((detail) => `<li style="margin:8px 0">${safeHtml(line(detail))}</li>`).join("")}</ul><p style="background:#F6F4EF;border-radius:8px;padding:12px">上传有效收款凭证并标记已收后，该账期会自动停止每日提醒。</p></main></div>`
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

async function renderDelivery(
  delivery: OwnerNotificationDelivery,
  timezone: string,
  now: string
) {
  const repository = getRepository();
  if (delivery.kind === "tenant_upload") {
    if (!delivery.tenantId) {
      throw new ApiError(500, "OWNER_NOTIFICATION_TENANT_MISSING", "Owner notification tenant is missing.");
    }
    const { tenant } = await repository.getTenant(delivery.tenantId);
    return tenantUploadMessage(tenant, timezone);
  }
  const generatedThrough = requiredPayloadTimestamp(delivery, "generatedThrough");
  const rent = await repository.rentReportSnapshot(
    delivery.kind === "daily_overdue_rent_summary" ? now : generatedThrough,
    timezone
  );
  if (delivery.kind === "daily_overdue_rent_summary") {
    const localDate = delivery.payload.localDate;
    const today = Temporal.Instant.from(now)
      .toZonedDateTimeISO(timezone)
      .toPlainDate()
      .toString();
    if (typeof localDate !== "string" || localDate !== today) return null;
    return rent.overdue.length === 0 ? null : dailyOverdueMessage(rent);
  }
  const periodStart = requiredPayloadTimestamp(delivery, "periodStart");
  const periodEnd = requiredPayloadTimestamp(delivery, "periodEnd");
  const todayStart = requiredPayloadTimestamp(delivery, "todayStart");
  const activity = await repository.tenantActivitySummary({
    periodStart,
    periodEnd,
    todayStart,
    now: generatedThrough
  });
  return weeklySummaryMessage(activity, rent, delivery.payload, timezone);
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
  if (!isOwnerWeeklySummaryEnabled()) {
    return { queued: false, reason: "weekly_summary_disabled" as const };
  }
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
      generatedThrough: window.generatedThrough,
      scheduledFor: window.scheduledFor
    },
    scheduledFor: window.scheduledFor
  });
  return { queued: true, deliveryId, scheduledFor: window.scheduledFor };
}

export async function enqueueDailyOverdueRentSummary(now = new Date()) {
  if (!isOwnerDailyOverdueEnabled()) {
    return { queued: false, reason: "daily_overdue_disabled" as const };
  }
  const timezone = process.env.DEFAULT_TIMEZONE ?? "America/Vancouver";
  const generatedThrough = now.toISOString();
  const localNow = Temporal.Instant.from(generatedThrough).toZonedDateTimeISO(timezone);
  const configuredTime = process.env.OWNER_DAILY_OVERDUE_TIME ?? "09:00";
  const dailyTime = /^\d{2}:\d{2}$/.test(configuredTime)
    ? Temporal.PlainTime.from(configuredTime)
    : Temporal.PlainTime.from("09:00");
  if (Temporal.PlainTime.compare(localNow.toPlainTime(), dailyTime) < 0) {
    return { queued: false, reason: "before_daily_schedule" as const };
  }
  const snapshot = await getRepository().rentReportSnapshot(generatedThrough, timezone);
  if (snapshot.overdue.length === 0) {
    return { queued: false, reason: "no_overdue_rent" as const };
  }
  const localDate = localNow.toPlainDate().toString();
  const email = getRepository().enqueueOwnerNotification({
    notificationKey: `daily-overdue-rent:${localDate}`,
    kind: "daily_overdue_rent_summary",
    tenantId: null,
    payload: { localDate, generatedThrough },
    scheduledFor: generatedThrough
  });
  const agent = getRepository().enqueueAgentNotification({
    eventKey: `agent-daily-overdue-rent:${localDate}`,
    kind: "daily_overdue_rent_summary",
    payload: {
      localDate,
      generatedThrough,
      paymentIds: snapshot.overdue.map((detail) => detail.payment.id)
    },
    availableAt: generatedThrough
  });
  const [emailResult, agentResult] = await Promise.allSettled([email, agent]);
  return {
    queued: emailResult.status === "fulfilled" || agentResult.status === "fulfilled",
    emailQueued: emailResult.status === "fulfilled",
    agentQueued: agentResult.status === "fulfilled",
    overdueCount: snapshot.overdue.length
  };
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
      const disabledSafeErrorCode = delivery.kind === "daily_overdue_rent_summary"
        ? !isOwnerDailyOverdueEnabled() && "OWNER_DAILY_OVERDUE_REPORT_DISABLED"
        : delivery.kind === "weekly_tenant_summary"
          ? !isOwnerWeeklySummaryEnabled() && "OWNER_WEEKLY_SUMMARY_REPORT_DISABLED"
          : false;
      if (disabledSafeErrorCode) {
        await repository.finishOwnerNotification(delivery.id, {
          status: "sent",
          providerMessageId: null,
          safeErrorCode: disabledSafeErrorCode,
          nextAttemptAt: null
        });
        summary.skipped += 1;
        continue;
      }
      const message = await renderDelivery(delivery, timezone, now.toISOString());
      if (!message) {
        await repository.finishOwnerNotification(delivery.id, {
          status: "sent",
          providerMessageId: null,
          safeErrorCode: "STALE_OR_RESOLVED_OVERDUE_RENT",
          nextAttemptAt: null
        });
        summary.skipped += 1;
        continue;
      }
      const result = await provider.send({
        to: recipient,
        ...message,
        idempotencyKey: `owner-notification:${delivery.notificationKey}`
      });
      if (delivery.kind === "weekly_tenant_summary") {
        const scheduledFor = typeof delivery.payload.scheduledFor === "string"
          ? delivery.payload.scheduledFor
          : delivery.notificationKey.replace(/^weekly-tenant-summary:/, "");
        await repository.enqueueAgentNotification({
          eventKey: `weekly-report-sent:${scheduledFor}`,
          kind: "weekly_report_sent",
          payload: {
            text: "今天的租客周报已经发送到你的邮箱，请你查看。",
            scheduledFor,
            ownerNotificationId: delivery.id
          },
          availableAt: now.toISOString()
        });
      }
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
