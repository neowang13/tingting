import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "../../src/app/api/public/showings/route";
import { getDemoShowingRequestsForTests } from "../../src/features/showings/service";

const schedule = {
  timezone: "America/Vancouver" as const,
  weeklySlots: [{ weekday: 1, times: ["10:30", "11:00"] }],
  dateOverrides: [
    { date: "2026-08-05", times: ["14:00"] },
    { date: "2026-08-10", times: ["15:00"] },
    { date: "2026-08-17", times: [] }
  ],
  updatedAt: "2026-08-01T15:00:00Z"
};

describe("/api/public/showings", () => {
  const originalBackend = process.env.DATA_BACKEND;

  beforeEach(() => {
    process.env.DATA_BACKEND = "memory";
    globalThis.__tingtingShowingRateLimits = new Map();
    globalThis.__tingtingShowingRequests = [];
    globalThis.__tingtingViewingSchedule = structuredClone(schedule);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T16:00:00Z"));
  });

  afterEach(() => {
    process.env.DATA_BACKEND = originalBackend;
    globalThis.__tingtingShowingRateLimits = undefined;
    globalThis.__tingtingShowingRequests = undefined;
    globalThis.__tingtingViewingSchedule = undefined;
    vi.useRealTimers();
  });

  it("returns only configured available spots within one calendar month", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body).toMatchObject({
      success: true,
      data: {
        window: { start: "2026-08-01", end: "2026-09-01", timezone: "America/Vancouver" }
      }
    });
    expect(body.data.dates.map((entry: { date: string }) => entry.date)).toEqual([
      "2026-08-03",
      "2026-08-05",
      "2026-08-10",
      "2026-08-24",
      "2026-08-31"
    ]);
    expect(body.data.dates.find((entry: { date: string }) => entry.date === "2026-08-03").spots)
      .toEqual([
        expect.objectContaining({ time: "10:30" }),
        expect.objectContaining({ time: "11:00" })
      ]);
    expect(body.data.dates.find((entry: { date: string }) => entry.date === "2026-08-10").spots)
      .toEqual([expect.objectContaining({ time: "15:00" })]);
  });

  it("omits nonexistent Vancouver times during the DST spring-forward gap", async () => {
    vi.setSystemTime(new Date("2027-03-01T20:00:00Z"));
    globalThis.__tingtingViewingSchedule = {
      timezone: "America/Vancouver",
      weeklySlots: [],
      dateOverrides: [{ date: "2027-03-14", times: ["02:30", "03:30"] }],
      updatedAt: "2027-03-01T19:00:00Z"
    };

    const availability = await (await GET()).json();
    expect(availability.data.dates).toEqual([
      expect.objectContaining({
        date: "2027-03-14",
        spots: [expect.objectContaining({ time: "03:30" })]
      })
    ]);
  });

  it("accepts and persists a valid API request", async () => {
    const response = await POST(new Request("https://example.test/api/public/showings", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.88" },
      body: JSON.stringify({
        name: "API Visitor",
        phone: "6045550110",
        email: "api-visitor@example.test",
        propertySlug: "howe-street-one-bedroom",
        requestedLocalDate: "2026-08-03",
        requestedLocalTime: "10:30",
        timezone: "America/Vancouver",
        notes: "",
        website: ""
      })
    }));
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      success: true,
      data: { status: "accepted", message: expect.stringMatching(/confirmed/i) }
    });
    expect(getDemoShowingRequestsForTests()).toHaveLength(1);

    const availability = await (await GET()).json();
    expect(availability.data.dates.find((entry: { date: string }) => entry.date === "2026-08-03").spots)
      .toEqual([expect.objectContaining({ time: "11:00" })]);
  });

  it("accepts but ignores obsolete consent fields from legacy API clients", async () => {
    const response = await POST(new Request("https://example.test/api/public/showings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Legacy Visitor",
        phone: "6045550110",
        email: "legacy@example.test",
        propertySlug: "howe-street-one-bedroom",
        requestedLocalDate: "2026-08-03",
        requestedLocalTime: "10:30",
        timezone: "America/Vancouver",
        notes: "",
        consent: true,
        website: ""
      })
    }));
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      success: true,
      data: { status: "accepted" }
    });
    expect(getDemoShowingRequestsForTests()).toHaveLength(1);
    expect(getDemoShowingRequestsForTests()[0]).not.toHaveProperty("consentAt");
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
