import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAutomationRepository,
  resetAutomationRepositoryForTests
} from "@/data/automation-repository";
import {
  GET,
  PATCH,
  POST,
  PUT
} from "@/app/api/automation/v1/[...segments]/route";
import { getRepository, resetRepositoryForTests } from "@/data/repository";
import { store } from "@/data/store";
import { resetEnvironmentCache } from "@/lib/env";
import { currentPaymentPeriod } from "@/features/rent-payments/service";
import { Temporal } from "@js-temporal/polyfill";

const context = (segments: string[]) => ({
  params: Promise.resolve({ segments })
});

describe("Automation API route", () => {
  beforeEach(() => {
    vi.stubEnv("DATA_BACKEND", "memory");
    vi.stubEnv("NEXT_PUBLIC_APP_MODE", "demo");
    vi.stubEnv("AUTOMATION_API_ENABLED", "true");
    vi.stubEnv("AUTOMATION_MUTATIONS_ENABLED", "true");
    vi.stubEnv("AUTOMATION_CONFIRMATIONS_ENABLED", "true");
    vi.stubEnv("AUTOMATION_TENANT_IMPORT_ENABLED", "true");
    vi.stubEnv("AUTOMATION_TOKEN_PEPPER", "route-test-pepper-value-that-is-longer-than-32-characters");
    resetEnvironmentCache();
    resetAutomationRepositoryForTests();
    resetRepositoryForTests();
    store.reset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvironmentCache();
    resetAutomationRepositoryForTests();
    resetRepositoryForTests();
  });

  it("authenticates, enforces exact scopes, and replays a mutation idempotently", async () => {
    const repository = getAutomationRepository();
    const credential = await repository.createServiceAccount({
      name: "Route test writer",
      delegatedAdminUserId: crypto.randomUUID(),
      scopes: ["rentals:write"],
      expiresAt: null
    }, crypto.randomUUID());
    const idempotencyKey = crypto.randomUUID();
    const body = {
      slug: "route-test-rental",
      title: "Route Test Rental",
      addressLine: "123 Main Street",
      city: "Vancouver",
      monthlyRentCents: 250000,
      bedrooms: 1,
      bathrooms: 1,
      description: "A safe draft created by the Automation API route test.",
      sortOrder: 0,
      images: [],
      sourceSystem: "route-test",
      externalReference: "rental-001"
    };
    const request = () => new Request("http://localhost/api/automation/v1/rentals", {
      method: "POST",
      headers: {
        authorization: `Bearer ${credential.token}`,
        "content-type": "application/json",
        "idempotency-key": idempotencyKey
      },
      body: JSON.stringify(body)
    });

    const first = await POST(request(), context(["rentals"]));
    const second = await POST(request(), context(["rentals"]));
    const firstPayload = await first.json();
    const secondPayload = await second.json();
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(secondPayload.data.id).toBe(firstPayload.data.id);

    const forbidden = await GET(new Request(
      "http://localhost/api/automation/v1/rentals",
      { headers: { authorization: `Bearer ${credential.token}` } }
    ), context(["rentals"]));
    expect(forbidden.status).toBe(403);
    expect((await forbidden.json()).error.code).toBe("AUTOMATION_SCOPE_REQUIRED");
  });

  it("creates a single tenant with masked output and unconfirmed contact permission", async () => {
    const repository = getAutomationRepository();
    const credential = await repository.createServiceAccount({
      name: "Tenant upload writer",
      delegatedAdminUserId: crypto.randomUUID(),
      scopes: ["tenants:read", "tenants:write"],
      expiresAt: null
    }, crypto.randomUUID());
    const response = await POST(new Request(
      "http://localhost/api/automation/v1/tenants",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${credential.token}`,
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID()
        },
        body: JSON.stringify({
          sourceSystem: "openclaw",
          externalReference: "lease-2026-0042",
          fullName: "Jane Chen",
          propertyLabel: "123 Main Street",
          unitLabel: "1208",
          leaseType: "month_to_month",
          leaseStartDate: "2026-08-01",
          rentDueDay: 1,
          email: "jane@example.com",
          preferredChannels: ["email"]
        })
      }
    ), context(["tenants"]));
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.data).toMatchObject({
      fullName: "Jane Chen",
      propertyLabel: "123 Main Street",
      unitLabel: "1208",
      emailMasked: "j***@example.com",
      phoneMasked: null,
      emailContactStatus: "unconfirmed",
      smsContactStatus: "unconfirmed",
      sourceSystem: "openclaw",
      externalReference: "lease-2026-0042"
    });
    expect(JSON.stringify(payload)).not.toContain("jane@example.com");
  });

  it("rejects a new tenant without complete lease facts", async () => {
    const repository = getAutomationRepository();
    const credential = await repository.createServiceAccount({
      name: "Tenant lease validation writer",
      delegatedAdminUserId: crypto.randomUUID(),
      scopes: ["tenants:write"],
      expiresAt: null
    }, crypto.randomUUID());
    const response = await POST(new Request(
      "http://localhost/api/automation/v1/tenants",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${credential.token}`,
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID()
        },
        body: JSON.stringify({
          fullName: "Incomplete Lease",
          propertyLabel: "123 Main Street",
          preferredChannels: []
        })
      }
    ), context(["tenants"]));

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("VALIDATION_ERROR");
  });

  it("matches a tenant, uploads a private receipt, marks rent collected, and reads it back", async () => {
    const repository = getAutomationRepository();
    const credential = await repository.createServiceAccount({
      name: "Rent payment assistant",
      delegatedAdminUserId: crypto.randomUUID(),
      scopes: ["payments:read", "payments:write"],
      expiresAt: null
    }, crypto.randomUUID());
    const period = currentPaymentPeriod(new Date().toISOString(), "America/Vancouver").slice(0, 7);
    const auth = { authorization: `Bearer ${credential.token}` };

    const wildcardMatch = await POST(new Request(
      "http://localhost/api/automation/v1/tenants/payment-match",
      {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({
          fullName: "%",
          email: "tenant@example.com",
          period
        })
      }
    ), context(["tenants", "payment-match"]));
    expect(wildcardMatch.status).toBe(404);

    const matchResponse = await POST(new Request(
      "http://localhost/api/automation/v1/tenants/payment-match",
      {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({
          fullName: "Demo Tenant",
          email: "tenant@example.com",
          period
        })
      }
    ), context(["tenants", "payment-match"]));
    const matchPayload = await matchResponse.json();
    expect(matchResponse.status, JSON.stringify(matchPayload)).toBe(200);
    expect(matchPayload.data).toMatchObject({
      unique: true,
      matches: [{
        id: "30000000-0000-4000-8000-000000000001",
        emailMasked: "te•••@example.com"
      }]
    });

    const form = new FormData();
    form.set("tenantId", matchPayload.data.matches[0].id);
    form.set("period", period);
    form.set("file", new File(
      [new TextEncoder().encode("%PDF-1.7 automation receipt")],
      "rent-receipt.pdf",
      { type: "application/pdf" }
    ));
    const receiptIdempotencyKey = crypto.randomUUID();
    const uploadResponse = await POST(new Request(
      "http://localhost/api/automation/v1/payment-receipts",
      {
        method: "POST",
        headers: { ...auth, "idempotency-key": receiptIdempotencyKey },
        body: form
      }
    ), context(["payment-receipts"]));
    const uploadPayload = await uploadResponse.json();
    expect(uploadResponse.status, JSON.stringify(uploadPayload)).toBe(201);

    const otherPeriod = Temporal.PlainDate.from(`${period}-01`)
      .add({ months: 1 })
      .toString()
      .slice(0, 7);
    const reusedForm = new FormData();
    reusedForm.set("tenantId", matchPayload.data.matches[0].id);
    reusedForm.set("period", otherPeriod);
    reusedForm.set("file", new File(
      [new TextEncoder().encode("%PDF-1.7 automation receipt")],
      "rent-receipt.pdf",
      { type: "application/pdf" }
    ));
    const reusedResponse = await POST(new Request(
      "http://localhost/api/automation/v1/payment-receipts",
      {
        method: "POST",
        headers: { ...auth, "idempotency-key": receiptIdempotencyKey },
        body: reusedForm
      }
    ), context(["payment-receipts"]));
    expect(reusedResponse.status).toBe(409);
    expect((await reusedResponse.json()).error.code).toBe("IDEMPOTENCY_KEY_REUSED");

    const collectResponse = await PUT(new Request(
      `http://localhost/api/automation/v1/tenants/${matchPayload.data.matches[0].id}/rent-payments/${period}/collected`,
      {
        method: "PUT",
        headers: {
          ...auth,
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID()
        },
        body: JSON.stringify({ receiptId: uploadPayload.data.id })
      }
    ), context([
      "tenants",
      matchPayload.data.matches[0].id,
      "rent-payments",
      period,
      "collected"
    ]));
    expect(collectResponse.status, await collectResponse.text()).toBe(200);

    const getResponse = await GET(new Request(
      `http://localhost/api/automation/v1/tenants/${matchPayload.data.matches[0].id}/rent-payments?period=${period}`,
      { headers: auth }
    ), context(["tenants", matchPayload.data.matches[0].id, "rent-payments"]));
    await expect(getResponse.json()).resolves.toMatchObject({
      data: {
        status: "collected",
        receiptId: uploadPayload.data.id
      }
    });
  });

  it("atomically onboards an owner-confirmed PDF tenant with email permission and reminders", async () => {
    const repository = getAutomationRepository();
    const credential = await repository.createServiceAccount({
      name: "PDF tenant onboarding writer",
      delegatedAdminUserId: crypto.randomUUID(),
      scopes: ["tenants:read", "tenants:write", "permissions:grant"],
      expiresAt: null
    }, crypto.randomUUID());
    const response = await POST(new Request(
      "http://localhost/api/automation/v1/tenant-onboardings",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${credential.token}`,
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID()
        },
        body: JSON.stringify({
          tenant: {
            sourceSystem: "openclaw",
            externalReference: "pdf-lease-2026-0043",
            fullName: "Mei Lin",
            propertyLabel: "456 Oak Street",
            unitLabel: "305",
            leaseType: "fixed_term",
            leaseStartDate: "2026-08-01",
            leaseEndDate: "2027-07-31",
            rentDueDay: 1,
            email: "mei@example.com",
            phoneE164: "+16045550123",
            preferredChannels: ["email", "sms"]
          },
          ownerConfirmation: {
            confirmedAt: "2026-07-30T20:00:00Z",
            documentDigest: `sha256:${"a".repeat(64)}`
          }
        })
      }
    ), context(["tenant-onboardings"]));
    const payload = await response.json();
    const saved = store.getTenant(payload.data.tenant.id);

    expect(response.status, JSON.stringify(payload)).toBe(201);
    expect(payload.data).toMatchObject({
      tenant: {
        fullName: "Mei Lin",
        emailMasked: "m***@example.com",
        emailContactStatus: "allowed",
        smsContactStatus: "unconfirmed"
      },
      emailPermission: {
        status: "allowed",
        source: "owner_confirmed_pdf_onboarding",
        recordedAt: "2026-07-30T20:00:00Z"
      },
      reminder: {
        configured: true,
        isEnabled: true,
        policy: "global"
      }
    });
    expect(saved.tenant.emailContactStatus).toBe("allowed");
    expect(saved.tenant.smsContactStatus).toBe("unconfirmed");
    expect(saved.schedule?.isEnabled).toBe(true);
    expect(saved.schedule?.nextRunAt).toBeTruthy();
    expect(JSON.stringify(payload)).not.toContain("mei@example.com");
    expect(JSON.stringify(payload)).not.toContain("+16045550123");
  });

  it("requires permission scope for owner-confirmed PDF onboarding", async () => {
    const repository = getAutomationRepository();
    const credential = await repository.createServiceAccount({
      name: "PDF tenant writer without permission scope",
      delegatedAdminUserId: crypto.randomUUID(),
      scopes: ["tenants:read", "tenants:write"],
      expiresAt: null
    }, crypto.randomUUID());
    const response = await POST(new Request(
      "http://localhost/api/automation/v1/tenant-onboardings",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${credential.token}`,
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID()
        },
        body: JSON.stringify({
          tenant: {
            fullName: "Mei Lin",
            propertyLabel: "456 Oak Street",
            email: "mei@example.com",
            preferredChannels: ["email"]
          },
          ownerConfirmation: {
            confirmedAt: "2026-07-30T20:00:00Z",
            documentDigest: `sha256:${"b".repeat(64)}`
          }
        })
      }
    ), context(["tenant-onboardings"]));

    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("AUTOMATION_SCOPE_REQUIRED");
  });

  it("drops stale Agent overdue events and returns only today's event", async () => {
    const automationRepository = getAutomationRepository();
    const credential = await automationRepository.createServiceAccount({
      name: "Agent overdue reader",
      delegatedAdminUserId: crypto.randomUUID(),
      scopes: ["payments:read"],
      expiresAt: null
    }, crypto.randomUUID());
    const repository = getRepository();
    const now = Temporal.Now.instant();
    const localToday = now.toZonedDateTimeISO("America/Vancouver").toPlainDate();
    await repository.createTenant({
      fullName: "Agent Overdue Tenant",
      propertyLabel: "789 Pine Street",
      unitLabel: null,
      moveInDate: localToday.subtract({ months: 2 }).toString(),
      leaseType: "month_to_month",
      leaseEndDate: null,
      rentDueDay: 1,
      email: null,
      phoneE164: null,
      preferredChannels: [],
      timezone: "America/Vancouver",
      internalNotes: null,
      isActive: true
    }, crypto.randomUUID());
    await repository.materializeRentPeriods(
      localToday.subtract({ months: 1 }).toString()
    );
    const availableAt = now.subtract({ seconds: 1 }).toString();
    await repository.enqueueAgentNotification({
      eventKey: `agent-stale:${crypto.randomUUID()}`,
      kind: "daily_overdue_rent_summary",
      payload: { localDate: localToday.subtract({ days: 1 }).toString() },
      availableAt
    });
    await repository.enqueueAgentNotification({
      eventKey: `agent-current:${crypto.randomUUID()}`,
      kind: "daily_overdue_rent_summary",
      payload: { localDate: localToday.toString() },
      availableAt
    });

    const response = await POST(new Request(
      "http://localhost/api/automation/v1/agent-notifications/claim",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${credential.token}`,
          "content-type": "application/json"
        },
        body: "{}"
      }
    ), context(["agent-notifications", "claim"]));
    const payload = await response.json();

    expect(response.status, JSON.stringify(payload)).toBe(200);
    expect(payload.data).toMatchObject({
      kind: "daily_overdue_rent_summary",
      text: expect.stringContaining("Agent Overdue Tenant")
    });
  });

  it("updates existing tenant fields without exposing stored contact data", async () => {
    const repository = getAutomationRepository();
    const credential = await repository.createServiceAccount({
      name: "Tenant field editor",
      delegatedAdminUserId: crypto.randomUUID(),
      scopes: ["tenants:write"],
      expiresAt: null
    }, crypto.randomUUID());
    const existing = store.listTenants()[0];
    const response = await PATCH(new Request(
      `http://localhost/api/automation/v1/tenants/${existing.id}`,
      {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${credential.token}`,
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID()
        },
        body: JSON.stringify({
          changes: {
            fullName: "Xiaochen Wang",
            email: "xiaochen@example.com",
            phoneE164: "+16045550123"
          },
          expectedVersion: existing.updatedAt
        })
      }
    ), context(["tenants", existing.id]));
    const payload = await response.json();
    const saved = store.getTenant(existing.id).tenant;

    expect(response.status, JSON.stringify(payload)).toBe(200);
    expect(payload.data).toMatchObject({
      fullName: "Xiaochen Wang",
      emailMasked: "x***@example.com",
      phoneMasked: "+16***23",
      preferredChannels: expect.arrayContaining(["email", "sms"]),
      emailContactStatus: "unconfirmed",
      smsContactStatus: "unconfirmed"
    });
    expect(saved.email).toBe("xiaochen@example.com");
    expect(saved.phoneE164).toBe("+16045550123");
    expect(JSON.stringify(payload)).not.toContain("xiaochen@example.com");
    expect(JSON.stringify(payload)).not.toContain("+16045550123");
  });

  it("preserves unrelated tenant fields during a partial update", async () => {
    const repository = getAutomationRepository();
    const credential = await repository.createServiceAccount({
      name: "Tenant partial-field editor",
      delegatedAdminUserId: crypto.randomUUID(),
      scopes: ["tenants:write"],
      expiresAt: null
    }, crypto.randomUUID());
    const existing = store.listTenants()[0];
    const before = store.getTenant(existing.id).tenant;
    const response = await PATCH(new Request(
      `http://localhost/api/automation/v1/tenants/${existing.id}`,
      {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${credential.token}`,
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID()
        },
        body: JSON.stringify({
          changes: {
            unitLabel: "507",
            rentDueDay: 15
          },
          expectedVersion: existing.updatedAt
        })
      }
    ), context(["tenants", existing.id]));
    const payload = await response.json();
    const saved = store.getTenant(existing.id).tenant;

    expect(response.status, JSON.stringify(payload)).toBe(200);
    expect(saved).toMatchObject({
      unitLabel: "507",
      rentDueDay: 15,
      email: before.email,
      phoneE164: before.phoneE164,
      preferredChannels: before.preferredChannels,
      emailContactStatus: before.emailContactStatus,
      smsContactStatus: before.smsContactStatus
    });
  });

  it("accepts Supabase offset timestamps as tenant resource versions", async () => {
    const repository = getAutomationRepository();
    const credential = await repository.createServiceAccount({
      name: "Supabase timestamp editor",
      delegatedAdminUserId: crypto.randomUUID(),
      scopes: ["tenants:write"],
      expiresAt: null
    }, crypto.randomUUID());
    const existing = store.listTenants()[0];
    const response = await PATCH(new Request(
      `http://localhost/api/automation/v1/tenants/${existing.id}`,
      {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${credential.token}`,
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID()
        },
        body: JSON.stringify({
          changes: {
            email: "xiaochen@example.com",
            phoneE164: "+17783856771"
          },
          expectedVersion: "2026-07-30T05:18:03.400566+00:00"
        })
      }
    ), context(["tenants", existing.id]));
    const payload = await response.json();

    expect(response.status, JSON.stringify(payload)).toBe(409);
    expect(payload.error.code).toBe("VERSION_CONFLICT");
  });

  it("rejects permission changes through the field-level tenant edit route", async () => {
    const repository = getAutomationRepository();
    const credential = await repository.createServiceAccount({
      name: "Tenant field editor",
      delegatedAdminUserId: crypto.randomUUID(),
      scopes: ["tenants:write"],
      expiresAt: null
    }, crypto.randomUUID());
    const existing = store.listTenants()[0];
    const response = await PATCH(new Request(
      `http://localhost/api/automation/v1/tenants/${existing.id}`,
      {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${credential.token}`,
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID()
        },
        body: JSON.stringify({
          changes: { emailContactStatus: "allowed" },
          expectedVersion: existing.updatedAt
        })
      }
    ), context(["tenants", existing.id]));

    const payload = await response.json();
    expect(response.status, JSON.stringify(payload)).toBe(400);
    expect(payload.error.code).toBe("VALIDATION_ERROR");
  });

  it("allows production HTTP only for an explicitly enabled loopback request", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const repository = getAutomationRepository();
    const credential = await repository.createServiceAccount({
      name: "Loopback health reader",
      delegatedAdminUserId: crypto.randomUUID(),
      scopes: [],
      expiresAt: null
    }, crypto.randomUUID());
    const request = () => new Request(
      "http://127.0.0.1/api/automation/v1/health",
      { headers: { authorization: `Bearer ${credential.token}` } }
    );

    const rejected = await GET(request(), context(["health"]));
    expect(rejected.status).toBe(400);
    expect((await rejected.json()).error.code).toBe("HTTPS_REQUIRED");

    vi.stubEnv("AUTOMATION_ALLOW_LOOPBACK_HTTP", "true");
    const accepted = await GET(request(), context(["health"]));
    expect(accepted.status).toBe(200);
    expect((await accepted.json()).data).toMatchObject({
      apiVersion: "v1",
      featureFlags: {
        api: true,
        mutations: true
      }
    });
  });
});
