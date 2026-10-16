import { describe, expect, it } from "vitest";
import { calendarMonthDays, calendarScheduleInput, selectedViewingDates } from "@/features/showings/calendar";
const window = { minimum: "2026-10-15", maximum: "2026-11-15" };
const schedule = { timezone: "America/Vancouver" as const, openWeekdays: [1], dateOverrides: [
  { date: "2026-10-19", available: false }, { date: "2026-10-20", available: true }, { date: "2026-12-01", available: true }
] };

describe("viewing calendar selection", () => {
  it("lays out Monday-first weeks and includes leap day without changing dates across timezones", () => {
    const cells = calendarMonthDays("2028-02");
    expect(cells[0]).toBeNull();
    expect(cells[1]).toBe("2028-02-01");
    expect(cells.filter(Boolean)).toHaveLength(29);
    expect(cells).toContain("2028-02-29");
    expect(cells.length % 7).toBe(0);
  });
  it("loads existing recurring days and specific exceptions into the visible selection", () => {
    expect(selectedViewingDates(schedule, window)).toEqual(["2026-10-20", "2026-10-26", "2026-11-02", "2026-11-09"]);
  });
  it("publishes exactly the selected dates in the booking window and preserves explicit future dates", () => {
    const saved = calendarScheduleInput(schedule, ["2026-10-16", "2026-11-14", "2026-11-14", "2026-11-15"], window);
    expect(saved.openWeekdays).toEqual([]);
    expect(saved.dateOverrides).toEqual([
      { date: "2026-10-16", available: true }, { date: "2026-11-14", available: true }, { date: "2026-12-01", available: true }
    ]);
    expect(selectedViewingDates(saved, window)).toEqual(["2026-10-16", "2026-11-14"]);
    expect(selectedViewingDates(calendarScheduleInput(schedule, [], window), window)).toEqual([]);
  });
});
