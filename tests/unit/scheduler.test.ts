import { describe, expect, it } from "vitest";
import { nextOccurrence } from "../../src/features/reminders/scheduler";

describe("nextOccurrence", () => {
  it("clamps day 31 to the final day in a short month", () => {
    expect(
      nextOccurrence({
        dayOfMonth: 31,
        localTime: "09:00",
        timezone: "America/Vancouver",
        afterInstant: "2026-02-01T00:00:00Z"
      })
    ).toBe("2026-02-28T17:00:00Z");
  });

  it.each([
    [29, "2026-02-28T17:00:00Z"],
    [30, "2026-02-28T17:00:00Z"],
    [31, "2026-02-28T17:00:00Z"]
  ])("uses the documented month-end fallback for day %i", (dayOfMonth, expected) => {
    expect(nextOccurrence({
      dayOfMonth,
      localTime: "09:00",
      timezone: "America/Vancouver",
      afterInstant: "2026-02-01T00:00:00Z"
    })).toBe(expected);
  });

  it("moves a nonexistent spring-forward time to the next valid instant", () => {
    expect(
      nextOccurrence({
        dayOfMonth: 8,
        localTime: "02:30",
        timezone: "America/Vancouver",
        afterInstant: "2026-03-01T00:00:00Z"
      })
    ).toBe("2026-03-08T10:30:00Z");
  });

  it("uses the earlier instant during fall-back", () => {
    expect(
      nextOccurrence({
        dayOfMonth: 1,
        localTime: "01:30",
        timezone: "America/Vancouver",
        afterInstant: "2026-10-15T00:00:00Z"
      })
    ).toBe("2026-11-01T08:30:00Z");
  });

  it("rejects an invalid IANA timezone", () => {
    expect(() => nextOccurrence({
      dayOfMonth: 1,
      localTime: "09:00",
      timezone: "Not/A_Timezone",
      afterInstant: "2026-01-01T00:00:00Z"
    })).toThrow();
  });
});
