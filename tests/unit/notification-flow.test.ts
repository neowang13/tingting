import { beforeEach, describe, expect, it } from "vitest";
import { store } from "../../src/data/store";

function batchPayload() {
  const tenant = store.listTenants()[0];
  const templates = store.listTemplates();
  return {
    selectionMode: "tenant_ids" as const,
    tenantIds: [tenant.id],
    channels: ["email"] as const,
    emailTemplateId: templates.find((template) => template.channel === "email")?.id ?? null,
    smsTemplateId: null,
    requestId: crypto.randomUUID()
  };
}

describe("manual notification flow", () => {
  beforeEach(() => {
    store.reset();
    process.env.REMINDERS_FORCE_PAUSED = "false";
    process.env.EMAIL_PROVIDER_MODE = "mock";
    process.env.SMS_PROVIDER_MODE = "mock";
  });

  it("freezes, confirms idempotently, and creates one event per eligible channel", () => {
    const payload = batchPayload();
    const batch = store.createBatch(payload);
    const confirmation = {
      confirmationIdempotencyKey: crypto.randomUUID(),
      acknowledgedRecipientCount: batch.eligibleCount
    };
    const confirmed = store.confirmBatch(batch.id, confirmation);
    expect(confirmed.status).toBe("confirmed");
    expect(store.confirmBatch(batch.id, confirmation).id).toBe(batch.id);
    expect(store.listEvents().filter((event) => event.source === "manual")).toHaveLength(1);
  });

  it("rejects confirmation when the frozen tenant changed", () => {
    const payload = batchPayload();
    const batch = store.createBatch(payload);
    const tenant = store.listTenants()[0];
    store.archiveTenant(tenant.id, tenant.updatedAt);
    expect(() => store.confirmBatch(batch.id, {
      confirmationIdempotencyKey: crypto.randomUUID(),
      acknowledgedRecipientCount: batch.eligibleCount
    })).toThrow("Recipient eligibility changed");
  });

  it("drains durable queued work through the mock provider", async () => {
    const pause = store.getPause();
    store.setPause(false, pause.updatedAt);
    const payload = batchPayload();
    const batch = store.createBatch(payload);
    store.confirmBatch(batch.id, {
      confirmationIdempotencyKey: crypto.randomUUID(),
      acknowledgedRecipientCount: batch.eligibleCount
    });
    const result = await store.runReminderWorker();
    expect(result).toMatchObject({ status: "completed", eventsDispatched: 1 });
    expect(store.listEvents()[0]).toMatchObject({ status: "queued", provider: "mock" });
  });

  it("queues test sends only for the saved administrator destination", () => {
    const tenant = store.listTenants()[0];
    const template = store.listTemplates().find((item) => item.channel === "email")!;
    expect(() => store.createTestEvent({
      tenantId: tenant.id,
      channel: "email",
      templateId: template.id,
      requestId: crypto.randomUUID()
    })).toThrow("Configure the admin-owned test destination first.");

    const contacts = store.getTestContacts();
    store.setTestContacts({
      email: "admin-test@example.com",
      phoneE164: null,
      expectedVersion: contacts.updatedAt
    });
    const event = store.createTestEvent({
      tenantId: tenant.id,
      channel: "email",
      templateId: template.id,
      requestId: crypto.randomUUID()
    });
    expect(event).toMatchObject({
      source: "test",
      destinationMasked: "a***@example.com",
      status: "scheduled"
    });
    expect(event.destinationMasked).not.toContain("tenant");
  });
});
