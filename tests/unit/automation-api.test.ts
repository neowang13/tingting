import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAutomationRepository,
  resetAutomationRepositoryForTests
} from "@/data/automation-repository";
import {
  GET,
  POST
} from "@/app/api/automation/v1/[...segments]/route";
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
});
