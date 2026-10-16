import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";
import { resolveShowingSlot, showingDateBounds } from "@/features/showings/scheduling";
import { getViewingSchedule, saveViewingSchedule, viewingScheduleInputSchema } from "@/features/showings/availability";

const schedule = {
  timezone: "America/Vancouver" as const,
  openWeekdays: [1, 6],
  dateOverrides: [{ date: "2026-08-05", available: true }, { date: "2026-08-17", available: false }]
};
const input = (date: string) => ({ requestedLocalDate: date, timezone: "America/Vancouver" });

describe("date-only property calendars", () => {
  it("uses Vancouver's calendar date across the UTC boundary without inventing a time", () => {
    const now = Temporal.Instant.from("2026-08-01T06:30:00Z");
    expect(showingDateBounds(now)).toEqual({ minimum: "2026-07-31", maximum: "2026-08-31" });
    expect(resolveShowingSlot(input("2026-08-01"), now, schedule)).toEqual({
      requestedLocalDate: "2026-08-01", requestedStartAt: null, requestedLocalTime: null, timezone: "America/Vancouver"
    });
  });

  it("lets explicit open and closed dates override weekly settings", () => {
    const now = Temporal.Instant.from("2026-08-01T16:00:00Z");
    expect(resolveShowingSlot(input("2026-08-05"), now, schedule).requestedLocalDate).toBe("2026-08-05");
    expect(() => resolveShowingSlot(input("2026-08-17"), now, schedule)).toThrow(expect.objectContaining({ code: "SHOWING_DATE_UNAVAILABLE" }));
  });

  it.each([
    ["2026-07-31", "SHOWING_DATE_PAST"],
    ["2026-09-01", "SHOWING_DATE_TOO_FAR"],
    ["2026-08-04", "SHOWING_DATE_UNAVAILABLE"],
    ["2026-02-30", "SHOWING_DATE_INVALID"]
  ])("rejects unavailable or invalid date %s", (date, code) => {
    expect(() => resolveShowingSlot(input(date), Temporal.Instant.from("2026-08-01T16:00:00Z"), schedule))
      .toThrow(expect.objectContaining({ code }));
  });

  it("keeps today's date available late in the day and handles the DST change as a date", () => {
    expect(resolveShowingSlot(input("2026-08-01"), Temporal.Instant.from("2026-08-02T06:59:00Z"), schedule).requestedLocalTime).toBeNull();
    expect(resolveShowingSlot(input("2027-03-14"), Temporal.Instant.from("2027-03-01T20:00:00Z"), {
      ...schedule, dateOverrides: [{ date: "2027-03-14", available: true }]
    }).requestedStartAt).toBeNull();
  });

  it("starts new calendars closed, isolates properties, and rejects concurrent or stale saves", async () => {
    process.env.DATA_BACKEND = "memory";
    globalThis.__tingtingPropertyViewingSchedules = new Map();
    expect((await getViewingSchedule("a")).openWeekdays).toEqual([]);
    const first = await saveViewingSchedule("a", schedule, null);
    expect((await getViewingSchedule("b")).openWeekdays).toEqual([]);
    await expect(saveViewingSchedule("a", schedule, null)).rejects.toMatchObject({ status: 409 });
    const updated = await saveViewingSchedule("a", { ...schedule, openWeekdays: [] }, first.updatedAt);
    expect(updated.updatedAt).not.toBe(first.updatedAt);
    await expect(saveViewingSchedule("a", schedule, first.updatedAt)).rejects.toMatchObject({ status: 409 });
    globalThis.__tingtingPropertyViewingSchedules = undefined;
  });

  it("rejects duplicate weekdays and dates", () => {
    expect(viewingScheduleInputSchema.safeParse({ ...schedule, openWeekdays: [1, 1] }).success).toBe(false);
    expect(viewingScheduleInputSchema.safeParse({ ...schedule, dateOverrides: [schedule.dateOverrides[0], schedule.dateOverrides[0]] }).success).toBe(false);
  });
});
