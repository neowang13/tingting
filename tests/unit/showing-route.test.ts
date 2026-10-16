import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/public/showings/route";
import { getDemoShowingRequestsForTests } from "@/features/showings/service";

const propertyId = "20000000-0000-4000-8000-000000000001";
const url = "https://example.test/api/public/showings";
const request = () => new Request(`${url}?propertySlug=howe-street-one-bedroom`);
const schedule = {
  rentalListingId: propertyId,
  timezone: "America/Vancouver" as const,
  openWeekdays: [1],
  dateOverrides: [{ date: "2026-08-05", available: true }, { date: "2026-08-17", available: false }],
  updatedAt: "2026-08-01T15:00:00Z"
};
function book(extra: Record<string, unknown> = {}) {
  return POST(new Request(url, {
    method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.88" },
    body: JSON.stringify({
      name: "API Visitor", phone: "6045550110", email: "visitor@example.test",
      propertySlug: "howe-street-one-bedroom", requestedLocalDate: "2026-08-03",
      timezone: "America/Vancouver", ...extra
    })
  }));
}

describe("/api/public/showings", () => {
  const originalBackend = process.env.DATA_BACKEND;
  beforeEach(() => {
    process.env.DATA_BACKEND = "memory";
    globalThis.__tingtingShowingRateLimits = new Map();
    globalThis.__tingtingShowingRequests = [];
    globalThis.__tingtingPropertyViewingSchedules = new Map([[propertyId, structuredClone(schedule)]]);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T16:00:00Z"));
  });
  afterEach(() => {
    process.env.DATA_BACKEND = originalBackend;
    globalThis.__tingtingShowingRateLimits = undefined;
    globalThis.__tingtingShowingRequests = undefined;
    globalThis.__tingtingPropertyViewingSchedules = undefined;
    vi.useRealTimers();
  });

  it("returns only this property's open dates within a calendar month, with no times", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body.data.window).toEqual({ start: "2026-08-01", end: "2026-09-01", timezone: "America/Vancouver" });
    expect(body.data.dates.map((entry: { date: string }) => entry.date)).toEqual([
      "2026-08-03", "2026-08-05", "2026-08-10", "2026-08-24", "2026-08-31"
    ]);
    expect(body.data.dates[0]).not.toHaveProperty("spots");
  });

  it("requires property context and keeps other unconfigured properties closed", async () => {
    expect((await GET(new Request(url))).status).toBe(400);
    expect((await GET(new Request(`${url}?propertySlug=missing-property`))).status).toBe(404);
    const other = await (await GET(new Request(`${url}?propertySlug=melville-street-two-bedroom`))).json();
    expect(other.data.dates).toEqual([]);
    expect((await book({ propertySlug: "melville-street-two-bedroom" })).status).toBe(400);
  });

  it("accepts multiple bookings on one date and leaves the date available", async () => {
    expect((await book()).status).toBe(202);
    expect((await book({ email: "second@example.test", phone: "6045550111" })).status).toBe(202);
    expect(getDemoShowingRequestsForTests()).toHaveLength(2);
    expect(getDemoShowingRequestsForTests()[0]).toMatchObject({ requestedStartAt: null, requestedLocalTime: null, requestedLocalDate: "2026-08-03" });
    expect((await (await GET(request())).json()).data.dates).toContainEqual(expect.objectContaining({ date: "2026-08-03" }));
  });

  it("accepts legacy fields without treating a supplied time as an appointment", async () => {
    expect((await book({ requestedLocalTime: "10:30", consent: true })).status).toBe(202);
    expect(getDemoShowingRequestsForTests()[0].requestedLocalTime).toBeNull();
    expect(getDemoShowingRequestsForTests()[0]).not.toHaveProperty("consentAt");
  });

  it("rejects malformed and closed dates without persisting", async () => {
    expect((await book({ name: "" })).status).toBe(400);
    expect((await book({ requestedLocalDate: "2026-08-17" })).status).toBe(400);
    expect((await book({ requestedLocalDate: "2026-02-30" })).status).toBe(400);
    expect(getDemoShowingRequestsForTests()).toHaveLength(0);
  });
});
