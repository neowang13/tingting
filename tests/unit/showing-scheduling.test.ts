import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";
import { resolveShowingSlot, showingDateBounds } from "../../src/features/showings/scheduling";

describe("showing scheduling", () => {
  it("resolves Vancouver local time across the UTC date boundary", () => {
    const now = Temporal.Instant.from("2026-08-01T06:30:00Z"); // July 31, 11:30 PM PDT
    expect(showingDateBounds(now)).toEqual({ minimum: "2026-07-31", maximum: "2026-09-29" });
    expect(resolveShowingSlot({
      requestedLocalDate: "2026-08-01",
      requestedLocalTime: "09:00",
      timezone: "America/Vancouver"
    }, now).requestedStartAt).toBe("2026-08-01T16:00:00Z");
  });

  it("uses the correct daylight-saving offset", () => {
    const slot = resolveShowingSlot({
      requestedLocalDate: "2027-03-15",
      requestedLocalTime: "09:30",
      timezone: "America/Vancouver"
    }, Temporal.Instant.from("2027-03-01T20:00:00Z"));
    expect(slot.requestedStartAt).toBe("2027-03-15T16:30:00Z");
  });

  it.each([
    ["a past local time", "2026-07-31", "18:00", "SHOWING_NOTICE_REQUIRED"],
    ["insufficient notice", "2026-08-01", "00:30", "SHOWING_SLOT_UNAVAILABLE"],
    ["Sunday", "2026-08-02", "10:00", "SHOWING_DAY_UNAVAILABLE"],
    ["outside business hours", "2026-08-03", "18:30", "SHOWING_SLOT_UNAVAILABLE"],
    ["outside the booking horizon", "2026-10-01", "10:00", "SHOWING_TIME_TOO_FAR"]
  ])("blocks %s", (_label, date, time, code) => {
    expect(() => resolveShowingSlot({
      requestedLocalDate: date,
      requestedLocalTime: time,
      timezone: "America/Vancouver"
    }, Temporal.Instant.from("2026-08-01T06:30:00Z"))).toThrow(expect.objectContaining({ code }));
  });
});
