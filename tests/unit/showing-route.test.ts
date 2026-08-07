import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST } from "../../src/app/api/public/showings/route";
import { getDemoShowingRequestsForTests } from "../../src/features/showings/service";

describe("POST /api/public/showings", () => {
  const originalBackend = process.env.DATA_BACKEND;

  beforeEach(() => {
    process.env.DATA_BACKEND = "memory";
    globalThis.__tingtingShowingRateLimits = new Map();
    globalThis.__tingtingShowingRequests = [];
  });

  afterEach(() => {
    process.env.DATA_BACKEND = originalBackend;
    globalThis.__tingtingShowingRateLimits = undefined;
    globalThis.__tingtingShowingRequests = undefined;
  });

  it("accepts and persists a valid API request", async () => {
    const tomorrow = new Date(Date.now() + 3 * 86_400_000);
    while (new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "America/Vancouver" }).format(tomorrow) === "Sun") {
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    }
    const requestedLocalDate = new Intl.DateTimeFormat("en-CA", {
      year: "numeric", month: "2-digit", day: "2-digit", timeZone: "America/Vancouver"
    }).format(tomorrow);
    const response = await POST(new Request("https://example.test/api/public/showings", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.88" },
      body: JSON.stringify({
        name: "API Visitor",
        phone: "6045550110",
        email: "api-visitor@example.test",
        propertySlug: "howe-street-one-bedroom",
        desiredMoveInDate: requestedLocalDate,
        requestedLocalDate,
        requestedLocalTime: "11:00",
        timezone: "America/Vancouver",
        notes: "",
        hasPets: false,
        needsParking: false,
        representationDisclosureAcknowledged: true,
        consent: true,
        website: ""
      })
    }));
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ success: true, data: { status: "requested" } });
    expect(getDemoShowingRequestsForTests()).toHaveLength(1);
  });

  it("returns clear validation errors without persistence", async () => {
    const response = await POST(new Request("https://example.test/api/public/showings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "", consent: false })
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      success: false,
      error: { code: "VALIDATION_ERROR" }
    });
    expect(getDemoShowingRequestsForTests()).toHaveLength(0);
  });
});
