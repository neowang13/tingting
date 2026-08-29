import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";
import { resolveShowingSlot, showingDateBounds } from "../../src/features/showings/scheduling";

const schedule = {
  timezone: "America/Vancouver" as const,
  weeklySlots: [
    { weekday: 1, times: ["09:30", "10:30"] },
    { weekday: 6, times: ["09:00", "10:00"] }
  ],
  dateOverrides: [
    { date: "2026-08-10", times: ["15:00"] },
    { date: "2026-08-17", times: [] }
  ],
  updatedAt: "2026-08-01T15:00:00Z"
};

describe("showing scheduling", () => {
  it("resolves Vancouver local time across the UTC date boundary", () => {
    const now = Temporal.Instant.from("2026-08-01T06:30:00Z"); // July 31, 11:30 PM PDT
    expect(showingDateBounds(now)).toEqual({ minimum: "2026-07-31", maximum: "2026-08-31" });
    expect(resolveShowingSlot({
      requestedLocalDate: "2026-08-01",
      requestedLocalTime: "09:00",
      timezone: "America/Vancouver"
    }, now, schedule).requestedStartAt).toBe("2026-08-01T16:00:00Z");
  });

  it("uses the correct daylight-saving offset", () => {
    const slot = resolveShowingSlot({
      requestedLocalDate: "2027-03-15",
      requestedLocalTime: "09:30",
      timezone: "America/Vancouver"
    }, Temporal.Instant.from("2027-03-01T20:00:00Z"), schedule);
    expect(slot.requestedStartAt).toBe("2027-03-15T16:30:00Z");
  });

  it("rejects a configured local time that does not exist during the DST spring-forward gap", () => {
    const springForwardSchedule = {
      ...schedule,
      dateOverrides: [{ date: "2027-03-14", times: ["02:30"] }]
    };

    expect(() => resolveShowingSlot({
      requestedLocalDate: "2027-03-14",
      requestedLocalTime: "02:30",
      timezone: "America/Vancouver"
    }, Temporal.Instant.from("2027-03-01T20:00:00Z"), springForwardSchedule)).toThrow(
      expect.objectContaining({ code: "SHOWING_TIME_INVALID" })
    );
  });

  it("allows only configured weekly slots and lets date overrides replace them", () => {
    expect(resolveShowingSlot({
      requestedLocalDate: "2026-08-03",
      requestedLocalTime: "10:30",
      timezone: "America/Vancouver"
    }, Temporal.Instant.from("2026-08-01T16:00:00Z"), schedule).requestedStartAt).toBe("2026-08-03T17:30:00Z");

    expect(resolveShowingSlot({
      requestedLocalDate: "2026-08-10",
      requestedLocalTime: "15:00",
      timezone: "America/Vancouver"
    }, Temporal.Instant.from("2026-08-01T16:00:00Z"), schedule).requestedStartAt).toBe("2026-08-10T22:00:00Z");

    for (const [date, time] of [["2026-08-10", "10:30"], ["2026-08-17", "10:30"]]) {
      expect(() => resolveShowingSlot({
        requestedLocalDate: date,
        requestedLocalTime: time,
        timezone: "America/Vancouver"
      }, Temporal.Instant.from("2026-08-01T16:00:00Z"), schedule)).toThrow(expect.objectContaining({
        code: "SHOWING_SLOT_UNAVAILABLE"
      }));
    }
  });

  it.each([
    ["insufficient notice", "2026-08-01", "10:00", "SHOWING_NOTICE_REQUIRED"],
    ["an unconfigured time", "2026-08-03", "11:00", "SHOWING_SLOT_UNAVAILABLE"],
    ["outside the one-month booking window", "2026-09-02", "10:30", "SHOWING_TIME_TOO_FAR"]
  ])("blocks %s", (_label, date, time, code) => {
    expect(() => resolveShowingSlot({
      requestedLocalDate: date,
      requestedLocalTime: time,
      timezone: "America/Vancouver"
    }, Temporal.Instant.from("2026-08-01T16:00:00Z"), schedule)).toThrow(expect.objectContaining({ code }));
  });
});
