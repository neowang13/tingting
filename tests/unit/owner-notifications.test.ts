import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getRepository, resetRepositoryForTests } from "@/data/repository";
import { store } from "@/data/store";
import {
  deliverOwnerNotifications,
  enqueueDailyOverdueRentSummary,
  enqueueTenantUploadNotification,
  enqueueWeeklyTenantSummary,
  latestWeeklySummaryWindow
} from "@/features/notifications/owner-notifications";
import type { EmailProvider } from "@/features/notifications/providers/types";

function tenantPayload(fullName: string) {
  return {
    fullName,
    propertyLabel: "123 Main Street",
    unitLabel: "1208",
    moveInDate: "2026-08-01",
    leaseType: "month_to_month" as const,
    leaseEndDate: null,
    rentDueDay: 1,
    email: "jane@example.com",
    phoneE164: "+16045550123",
    preferredChannels: ["email", "sms"],
    emailContactStatus: "unconfirmed",
    smsContactStatus: "unconfirmed",
    emailContactStatusReason: null,
    smsContactStatusReason: null,
    emailContactStatusSource: null,
    smsContactStatusSource: null,
    contactPermissionNote: null,
    contactPermissionUpdatedAt: null,
    timezone: "America/Vancouver",
    internalNotes: null,
    isActive: true
  };
}

describe("owner email notifications", () => {
  beforeEach(() => {
    vi.stubEnv("DATA_BACKEND", "memory");
    vi.stubEnv("EMAIL_PROVIDER_MODE", "mock");
    vi.stubEnv("OWNER_NOTIFICATION_TO_EMAIL", "owner@example.test");
    vi.stubEnv("OWNER_DAILY_OVERDUE_ENABLED", "true");
    vi.stubEnv("OWNER_DAILY_OVERDUE_TIME", "09:00");
    vi.stubEnv("DEFAULT_TIMEZONE", "America/Vancouver");
    vi.stubEnv("OWNER_WEEKLY_SUMMARY_ENABLED", "true");
    vi.stubEnv("OWNER_WEEKLY_SUMMARY_DAY", "1");
    vi.stubEnv("OWNER_WEEKLY_SUMMARY_TIME", "09:00");
    resetRepositoryForTests();
    store.reset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetRepositoryForTests();
    store.reset();
  });

  it("emails the full tenant details after a successful upload", async () => {
    const tenant = await getRepository().createTenant(tenantPayload("Jane Chen"), crypto.randomUUID());
    await enqueueTenantUploadNotification(tenant);
    const send = vi.fn().mockResolvedValue({
      providerMessageId: "email-1",
      status: "queued"
    });

    await expect(deliverOwnerNotifications({
      now: new Date(Date.now() + 1_000),
      provider: { send } as EmailProvider
    })).resolves.toMatchObject({ claimed: 1, sent: 1, failed: 0 });

    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      to: "owner@example.test",
      subject: "租客信息上传完成：Jane Chen",
      text: expect.stringContaining("Email：jane@example.com"),
      html: expect.stringContaining("Month to month")
    }));
  });

  it("matches Resend delivery feedback to a durable owner email", async () => {
    const repository = getRepository();
    const deliveryId = await repository.enqueueOwnerNotification({
      notificationKey: "delivery-feedback-test",
      kind: "application_submission",
      tenantId: null,
      payload: {},
      scheduledFor: new Date().toISOString()
    });
    await repository.finishOwnerNotification(deliveryId, {
      status: "sent",
      providerMessageId: "resend-owner-message",
      safeErrorCode: null,
      nextAttemptAt: null
    });

    await expect(repository.applyOwnerNotificationProviderStatus(
      "resend-owner-message", "delivered", "email.delivered"
    )).resolves.toBe(deliveryId);
    await expect(repository.applyOwnerNotificationProviderStatus(
      "unknown-message", "delivered", "email.delivered"
    )).resolves.toBeNull();
    await expect(repository.applyOwnerNotificationProviderStatus(
      "resend-owner-message", "sent", "email.sent"
    )).resolves.toBe(deliveryId);
    await expect(deliverOwnerNotifications({
      now: new Date(Date.now() + 24 * 60 * 60_000),
      provider: { send: vi.fn() } as EmailProvider
    })).resolves.toMatchObject({ claimed: 0 });
  });

  it("fails malformed or recipient-less application deliveries without sending", async () => {
    const repository = getRepository();
    await repository.enqueueOwnerNotification({
      notificationKey: "application-missing-recipient",
      kind: "application_submission",
      tenantId: null,
      payload: {
        applicationId: "application-id", fileIds: [], partIndex: 1,
        partCount: 1, appBaseUrl: "https://silverkey.ca"
      },
      scheduledFor: new Date().toISOString()
    });
    const send = vi.fn();

    await expect(deliverOwnerNotifications({
      now: new Date(Date.now() + 1_000),
      provider: { send } as EmailProvider
    })).resolves.toMatchObject({ claimed: 1, sent: 0, failed: 1 });
    expect(send).not.toHaveBeenCalled();
  });

  it("does not queue daily or weekly owner reports when their switches are disabled", async () => {
    vi.stubEnv("OWNER_DAILY_OVERDUE_ENABLED", "false");
    vi.stubEnv("OWNER_WEEKLY_SUMMARY_ENABLED", "false");
    const repository = getRepository();
    await repository.createTenant({
      ...tenantPayload("Disabled Report Tenant"),
      moveInDate: "2026-01-01",
      rentDueDay: 1
    }, crypto.randomUUID());
    await repository.materializeRentPeriods("2026-08-10");
    const enqueueOwner = vi.spyOn(repository, "enqueueOwnerNotification");
    const enqueueAgent = vi.spyOn(repository, "enqueueAgentNotification");

    await expect(enqueueDailyOverdueRentSummary(
      new Date("2026-08-10T16:01:00.000Z")
    )).resolves.toEqual({
      queued: false,
      reason: "daily_overdue_disabled"
    });
    await expect(enqueueWeeklyTenantSummary(
      new Date("2026-08-10T16:01:00.000Z")
    )).resolves.toEqual({
      queued: false,
      reason: "weekly_summary_disabled"
    });
    expect(enqueueOwner).not.toHaveBeenCalled();
    expect(enqueueAgent).not.toHaveBeenCalled();
  });

  it("terminally skips queued disabled reports while still delivering tenant uploads", async () => {
    const repository = getRepository();
    const tenant = await repository.createTenant({
      ...tenantPayload("Allowed Upload Tenant"),
      moveInDate: "2026-01-01",
      rentDueDay: 1
    }, crypto.randomUUID());
    await repository.materializeRentPeriods("2026-08-10");
    await enqueueDailyOverdueRentSummary(new Date("2026-08-10T16:01:00.000Z"));
    await enqueueWeeklyTenantSummary(new Date("2026-08-10T16:01:00.000Z"));
    await enqueueTenantUploadNotification(tenant);
    vi.stubEnv("OWNER_DAILY_OVERDUE_ENABLED", "false");
    vi.stubEnv("OWNER_WEEKLY_SUMMARY_ENABLED", "false");
    const finish = vi.spyOn(repository, "finishOwnerNotification");
    const send = vi.fn().mockResolvedValue({
      providerMessageId: "upload-only",
      status: "queued"
    });

    await expect(deliverOwnerNotifications({
      now: new Date(Date.now() + 1_000),
      provider: { send } as EmailProvider
    })).resolves.toMatchObject({ claimed: 3, sent: 1, failed: 0, skipped: 2 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      subject: "租客信息上传完成：Allowed Upload Tenant"
    }));
    expect(finish).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      status: "sent",
      safeErrorCode: "OWNER_DAILY_OVERDUE_REPORT_DISABLED",
      nextAttemptAt: null
    }));
    expect(finish).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      status: "sent",
      safeErrorCode: "OWNER_WEEKLY_SUMMARY_REPORT_DISABLED",
      nextAttemptAt: null
    }));
  });

  it("deduplicates the weekly summary and reports active, seven-day, and today counts", async () => {
    const scheduled = new Date("2026-08-03T16:05:00.000Z");
    const window = latestWeeklySummaryWindow(scheduled);
    expect(window.scheduledFor).toBe("2026-08-03T16:00:00Z");
    expect(window.weekday).toBe("Monday");

    await enqueueWeeklyTenantSummary(scheduled);
    await enqueueWeeklyTenantSummary(new Date("2026-08-03T16:10:00.000Z"));
    const send = vi.fn().mockResolvedValue({
      providerMessageId: "email-weekly",
      status: "queued"
    });
    const provider = { send } as EmailProvider;

    await expect(deliverOwnerNotifications({ now: scheduled, provider }))
      .resolves.toMatchObject({ claimed: 1, sent: 1 });
    await expect(deliverOwnerNotifications({
      now: new Date("2026-08-03T16:15:00.000Z"),
      provider
    })).resolves.toMatchObject({ claimed: 0, sent: 0 });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      subject: expect.stringMatching(/^婷婷租务周报｜本周应收 \d+ · 已收 \d+ · 还差 \d+$/),
      html: expect.stringMatching(/<p style="color:#FFFFFF;margin:0">[\s\S]*本周收款[\s\S]*本周收款活动（包含补收往期）[\s\S]*下周到期[\s\S]*逾期未收[\s\S]*租客动态[\s\S]*固定租约即将到期/),
      text: expect.stringMatching(/本周应收[\s\S]*本周已收[\s\S]*本周还差[\s\S]*下周应收[\s\S]*已提前收到[\s\S]*下周待收[\s\S]*逾期未收[\s\S]*过去 7 天新增[\s\S]*Month to month[\s\S]*未来 7 天到期 Fixed contract[\s\S]*未来 30 天到期 Fixed contract/)
    }));
    await expect(getRepository().claimAgentNotification(
      crypto.randomUUID(),
      "2026-08-03T16:06:00.000Z"
    )).resolves.toMatchObject({
      kind: "weekly_report_sent",
      payload: expect.objectContaining({
        text: "今天的租客周报已经发送到你的邮箱，请你查看。"
      })
    });
  });

  it("queues overdue email and Agent reminders once per local day after 09:00", async () => {
    const repository = getRepository();
    await repository.createTenant({
      ...tenantPayload("Overdue Tenant"),
      moveInDate: "2026-01-01",
      rentDueDay: 1,
      email: "overdue@example.com"
    }, crypto.randomUUID());
    await repository.materializeRentPeriods("2026-08-10");

    await expect(enqueueDailyOverdueRentSummary(
      new Date("2026-08-10T15:59:00.000Z")
    )).resolves.toMatchObject({
      queued: false,
      reason: "before_daily_schedule"
    });
    await expect(enqueueDailyOverdueRentSummary(
      new Date("2026-08-10T16:01:00.000Z")
    )).resolves.toMatchObject({
      queued: true,
      emailQueued: true,
      agentQueued: true
    });
    await expect(enqueueDailyOverdueRentSummary(
      new Date("2026-08-10T16:05:00.000Z")
    )).resolves.toMatchObject({
      queued: true
    });

    await expect(repository.claimAgentNotification(
      crypto.randomUUID(),
      "2026-08-10T16:06:00.000Z"
    )).resolves.toMatchObject({
      kind: "daily_overdue_rent_summary",
      payload: expect.objectContaining({ localDate: "2026-08-10" })
    });
  });

  it("still queues the Agent overdue reminder when the email queue is unavailable", async () => {
    const repository = getRepository();
    await repository.createTenant({
      ...tenantPayload("Independent Channel Tenant"),
      moveInDate: "2026-01-01",
      rentDueDay: 1,
      email: "independent@example.com"
    }, crypto.randomUUID());
    await repository.materializeRentPeriods("2026-08-11");
    vi.spyOn(repository, "enqueueOwnerNotification")
      .mockRejectedValueOnce(new Error("email queue unavailable"));

    await expect(enqueueDailyOverdueRentSummary(
      new Date("2026-08-11T16:01:00.000Z")
    )).resolves.toMatchObject({
      queued: true,
      emailQueued: false,
      agentQueued: true
    });
  });

  it("skips a stale daily overdue email instead of sending it on a later day", async () => {
    const repository = getRepository();
    await repository.createTenant({
      ...tenantPayload("Stale Reminder Tenant"),
      moveInDate: "2026-01-01",
      rentDueDay: 1,
      email: "stale@example.com"
    }, crypto.randomUUID());
    await repository.materializeRentPeriods("2026-08-10");
    await enqueueDailyOverdueRentSummary(new Date("2026-08-10T16:01:00.000Z"));
    const send = vi.fn().mockResolvedValue({
      providerMessageId: "must-not-send",
      status: "queued"
    });

    await expect(deliverOwnerNotifications({
      now: new Date("2026-08-11T16:01:00.000Z"),
      provider: { send } as EmailProvider
    })).resolves.toMatchObject({ claimed: 1, sent: 0, skipped: 1 });
    expect(send).not.toHaveBeenCalled();
  });

  it("retries a failed owner email with backoff without duplicating the queue item", async () => {
    const tenant = await getRepository().createTenant(tenantPayload("Retry Tenant"), crypto.randomUUID());
    await enqueueTenantUploadNotification(tenant);
    const firstAttemptAt = new Date(Date.now() + 1_000);
    const failingProvider = {
      send: vi.fn().mockRejectedValue(new Error("provider unavailable"))
    } as EmailProvider;

    await expect(deliverOwnerNotifications({ now: firstAttemptAt, provider: failingProvider }))
      .resolves.toMatchObject({ claimed: 1, failed: 1 });

    const successfulProvider = {
      send: vi.fn().mockResolvedValue({ providerMessageId: "email-retry", status: "queued" })
    } as EmailProvider;
    await expect(deliverOwnerNotifications({
      now: new Date(firstAttemptAt.getTime() + 4 * 60_000),
      provider: successfulProvider
    })).resolves.toMatchObject({ claimed: 0 });
    await expect(deliverOwnerNotifications({
      now: new Date(firstAttemptAt.getTime() + 6 * 60_000),
      provider: successfulProvider
    })).resolves.toMatchObject({ claimed: 1, sent: 1 });
  });

  it("retries the weekly completion event with the same email idempotency key", async () => {
    const scheduled = new Date("2026-08-03T16:05:00.000Z");
    const repository = getRepository();
    await enqueueWeeklyTenantSummary(scheduled);
    vi.spyOn(repository, "enqueueAgentNotification")
      .mockRejectedValueOnce(new Error("Agent outbox unavailable"));
    const send = vi.fn().mockResolvedValue({
      providerMessageId: "email-weekly-retry",
      status: "queued"
    });
    const provider = { send } as EmailProvider;

    await expect(deliverOwnerNotifications({ now: scheduled, provider }))
      .resolves.toMatchObject({ claimed: 1, sent: 0, failed: 1 });
    await expect(deliverOwnerNotifications({
      now: new Date("2026-08-03T16:11:00.000Z"),
      provider
    })).resolves.toMatchObject({ claimed: 1, sent: 1, failed: 0 });

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls.map(([input]) => input.idempotencyKey))
      .toEqual([
        "owner-notification:weekly-tenant-summary:2026-08-03T16:00:00Z",
        "owner-notification:weekly-tenant-summary:2026-08-03T16:00:00Z"
      ]);
    await expect(repository.claimAgentNotification(
      crypto.randomUUID(),
      "2026-08-03T16:12:00.000Z"
    )).resolves.toMatchObject({ kind: "weekly_report_sent" });
  });
});
