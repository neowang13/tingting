import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { store } from "@/data/store";
import { attemptImmediateReminderCatchUp } from "@/features/reminders/catch-up";

const tenantPayload = {
  fullName: "Alex Cross-Month",
  propertyLabel: "Harbour House",
  unitLabel: "203",
  moveInDate: "2026-07-15",
  rentDueDay: 1,
  email: "alex-cross-month@example.test",
  phoneE164: null,
  preferredChannels: ["email"],
  emailContactStatus: "allowed",
  smsContactStatus: "unconfirmed",
  emailContactStatusReason: null,
  smsContactStatusReason: null,
  emailContactStatusSource: "test",
  smsContactStatusSource: null,
  contactPermissionNote: null,
  contactPermissionUpdatedAt: "2026-07-27T20:00:00Z",
  timezone: "America/Vancouver",
  internalNotes: null,
  isActive: true
};

describe("memory global reminder policy", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-27T20:00:00Z"));
    store.reset();
  });

  afterEach(() => {
    delete process.env.REMINDERS_FORCE_PAUSED;
    delete process.env.EMAIL_PROVIDER_MODE;
    delete process.env.DATA_BACKEND;
    vi.useRealTimers();
  });

  it("derives a new tenant schedule from the global settings", () => {
    const tenant = store.createTenant(tenantPayload);
    const { schedule } = store.getTenant(tenant.id);

    expect(schedule).toMatchObject({
      rentDueDay: 1,
      localTime: "09:00",
      timezone: "America/Vancouver",
      channels: ["email"],
      isEnabled: true,
      nextRunAt: "2026-07-29T16:00:00Z"
    });
  });

  it("immediately sends a newly eligible reminder even when its planned time was over 24 hours ago", async () => {
    vi.setSystemTime(new Date("2026-07-31T08:30:00Z"));
    process.env.DATA_BACKEND = "memory";
    process.env.REMINDERS_FORCE_PAUSED = "false";
    process.env.EMAIL_PROVIDER_MODE = "mock";
    const settings = store.getPause();
    store.setPause(false, settings.updatedAt);

    const tenant = store.createTenant({
      ...tenantPayload,
      leaseType: "fixed_term",
      leaseEndDate: "2027-07-31"
    });
    expect(store.getTenant(tenant.id).schedule?.nextRunAt).toBe("2026-07-29T16:00:00Z");

    await expect(attemptImmediateReminderCatchUp(tenant.id)).resolves.toEqual({
      attempted: true,
      status: "processed",
      scheduledFor: "2026-07-29T16:00:00Z"
    });
    expect(
      store.listEvents().find((event) => event.tenantId === tenant.id)
    ).toMatchObject({
      status: "queued",
      scheduledFor: "2026-07-29T16:00:00Z",
      lastErrorCode: null
    });
  });

  it("saves the business name with optimistic concurrency", () => {
    const settings = store.getPause();
    vi.advanceTimersByTime(1);
    const saved = store.saveBusinessName("Ting Ting Property Group", settings.updatedAt);

    expect(saved.businessName).toBe("Ting Ting Property Group");
    expect(saved.updatedAt).not.toBe(settings.updatedAt);
    expect(() => store.saveBusinessName("Stale update", settings.updatedAt)).toThrowError(
      expect.objectContaining({ code: "VERSION_CONFLICT", status: 409 })
    );
  });

  it("preserves nextRunAt for ordinary tenant edits and template-only changes", () => {
    const tenant = store.createTenant(tenantPayload);
    const original = store.getTenant(tenant.id).schedule!;

    vi.setSystemTime(new Date("2026-07-27T20:01:00Z"));
    const updated = store.updateTenant(
      tenant.id,
      { ...tenantPayload, internalNotes: "Prefers email." },
      tenant.updatedAt
    );
    expect(store.getTenant(tenant.id).schedule?.nextRunAt).toBe(original.nextRunAt);

    const template = store.createTemplate({
      name: "Alternative rent reminder",
      channel: "email",
      subjectTemplate: "Upcoming rent",
      bodyTemplate: "Hi {{tenant_name}}, rent is due {{due_date}}.",
      isActive: true
    });
    const settings = store.getPause();
    const result = store.saveReminderSettings({
      paused: settings.paused,
      leadDays: settings.leadDays,
      localTime: settings.localTime,
      timezone: settings.timezone,
      emailTemplateId: template.id,
      expectedVersion: settings.updatedAt
    });

    expect(result.recalculatedTenants).toBe(0);
    expect(store.getTenant(updated.id).schedule?.nextRunAt).toBe(original.nextRunAt);
  });

  it("recalculates future schedules but preserves an already-due occurrence", () => {
    const tenant = store.createTenant(tenantPayload);
    const original = store.getTenant(tenant.id).schedule!;
    const settings = store.getPause();

    vi.setSystemTime(new Date("2026-07-30T17:00:00Z"));
    const result = store.saveReminderSettings({
      paused: settings.paused,
      leadDays: 5,
      localTime: settings.localTime,
      timezone: settings.timezone,
      emailTemplateId: settings.emailTemplateId,
      expectedVersion: settings.updatedAt
    });

    expect(result.preservedDueTenants).toBe(1);
    expect(store.getTenant(tenant.id).schedule?.nextRunAt).toBe(original.nextRunAt);
  });

  it("rejects legacy per-tenant schedule overrides with an explicit compatibility error", () => {
    const tenant = store.createTenant(tenantPayload);
    const schedule = store.getTenant(tenant.id).schedule!;
    expect(() => store.saveSchedule(tenant.id, {
      rentDueDay: tenant.rentDueDay,
      dayOfMonth: 10,
      localTime: "12:00",
      timezone: "America/Vancouver",
      channels: ["email"],
      emailTemplateId: schedule.emailTemplateId,
      smsTemplateId: null,
      isEnabled: true
    }, schedule.updatedAt)).toThrowError(expect.objectContaining({
      code: "GLOBAL_REMINDER_POLICY",
      status: 409
    }));
  });
});
