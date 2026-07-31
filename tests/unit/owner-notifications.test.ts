import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getRepository, resetRepositoryForTests } from "@/data/repository";
import { store } from "@/data/store";
import {
  deliverOwnerNotifications,
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
    vi.stubEnv("DEFAULT_TIMEZONE", "America/Vancouver");
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
      html: expect.stringContaining("123 Main Street")
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
      subject: expect.stringMatching(/^租客周报：\d+ 位 Active 租客$/),
      text: expect.stringContaining("过去 7 天新增"),
      html: expect.stringContaining("今天新增")
    }));
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
});
