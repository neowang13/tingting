import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { store } from "../../src/data/store";

describe("reminder worker capacity", () => {
  beforeEach(() => {
    store.reset();
    process.env.REMINDERS_FORCE_PAUSED = "false";
    process.env.EMAIL_PROVIDER_MODE = "mock";
    process.env.SMS_PROVIDER_MODE = "mock";
    process.env.MOCK_PROVIDER_LATENCY_MS = "15";
  });

  afterEach(() => {
    delete process.env.MOCK_PROVIDER_LATENCY_MS;
  });

  it("drains 100 recipients across both channels with bounded parallel chunks", async () => {
    for (let index = 1; index < 100; index += 1) {
      store.createTenant({
        fullName: `Capacity Tenant ${index}`,
        propertyLabel: `Capacity Property ${index}`,
        unitLabel: String(index),
        moveInDate: "2099-01-01",
        email: `capacity-${index}@example.com`,
        phoneE164: `+1604555${String(index).padStart(4, "0")}`,
        preferredChannels: ["email", "sms"],
        emailContactStatus: "allowed",
        smsContactStatus: "allowed",
        emailContactStatusReason: "capacity fixture",
        smsContactStatusReason: "capacity fixture",
        emailContactStatusSource: "test",
        smsContactStatusSource: "test",
        contactPermissionNote: "capacity fixture only",
        contactPermissionUpdatedAt: new Date().toISOString(),
        timezone: "America/Vancouver",
        internalNotes: null,
        isActive: true
      });
    }

    const templates = store.listTemplates();
    const batch = store.createBatch({
      selectionMode: "all_active",
      tenantIds: [],
      channels: ["email", "sms"],
      emailTemplateId: templates.find((template) => template.channel === "email")!.id,
      smsTemplateId: templates.find((template) => template.channel === "sms")!.id,
      requestId: crypto.randomUUID()
    });
    expect(batch.eligibleCount).toBe(200);
    store.confirmBatch(batch.id, {
      confirmationIdempotencyKey: crypto.randomUUID(),
      acknowledgedRecipientCount: batch.eligibleCount
    });
    const pause = store.getPause();
    store.setPause(false, pause.updatedAt);

    const startedAt = performance.now();
    const result = await store.runReminderWorker();
    const elapsedMilliseconds = performance.now() - startedAt;

    expect(result).toMatchObject({
      status: "completed",
      eventsDispatched: 200,
      eventsFailed: 0,
      backlogRemaining: 0
    });
    expect(elapsedMilliseconds).toBeLessThan(2_000);
    expect(elapsedMilliseconds).toBeGreaterThanOrEqual(200);
  });
});
