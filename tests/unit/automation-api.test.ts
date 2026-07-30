import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAutomationRepository,
  resetAutomationRepositoryForTests
} from "@/data/automation-repository";
import {
  GET,
  PATCH,
  POST
} from "@/app/api/automation/v1/[...segments]/route";
import { store } from "@/data/store";
import { resetEnvironmentCache } from "@/lib/env";

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
    store.reset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvironmentCache();
    resetAutomationRepositoryForTests();
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

  it("updates existing tenant contacts through a field-level patch", async () => {
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
            email: "xiaochen@example.com",
            phoneE164: "+17783856771"
          },
          expectedVersion: existing.updatedAt
        })
      }
    ), context(["tenants", existing.id]));
    const payload = await response.json();
    const saved = store.getTenant(existing.id).tenant;

    expect(response.status, JSON.stringify(payload)).toBe(200);
    expect(payload.data).toMatchObject({
      emailMasked: "x***@example.com",
      phoneMasked: "+17***71",
      preferredChannels: expect.arrayContaining(["email", "sms"]),
      emailContactStatus: "unconfirmed",
      smsContactStatus: "unconfirmed"
    });
    expect(saved.email).toBe("xiaochen@example.com");
    expect(saved.phoneE164).toBe("+17783856771");
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
          changes: { email: "xiaochen@example.com" },
          expectedVersion: "2026-07-30T05:18:03.400566+00:00"
        })
      }
    ), context(["tenants", existing.id]));
    const payload = await response.json();

    expect(response.status, JSON.stringify(payload)).toBe(409);
    expect(payload.error.code).toBe("VERSION_CONFLICT");
  });

  it("rejects permission changes through the tenant patch route", async () => {
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
});
