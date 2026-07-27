import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { store } from "@/data/store";

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
