import { describe, expect, it } from "vitest";
import {
  formatRentDueDate,
  nextRentDueDateFromInstant,
  rentDueDateForOccurrence
} from "../../src/features/reminders/due-date";

describe("rent due date", () => {
  it("uses the current month when the due day is still ahead", () => {
    expect(rentDueDateForOccurrence("2026-07-27", 31)).toBe("2026-07-31");
  });

  it("moves to the next month when this month's due day passed", () => {
    expect(rentDueDateForOccurrence("2026-07-27", 1)).toBe("2026-08-01");
  });

  it("clamps day 31 to the final day of a shorter month", () => {
    expect(rentDueDateForOccurrence("2027-02-01", 31)).toBe("2027-02-28");
  });

  it("calculates from the tenant timezone instead of UTC date", () => {
    const dueDate = nextRentDueDateFromInstant(
      "2026-08-01T06:30:00.000Z",
      "America/Vancouver",
      1
    );
    expect(dueDate).toBe("2026-08-01");
    expect(formatRentDueDate(dueDate)).toContain("August");
  });
});
