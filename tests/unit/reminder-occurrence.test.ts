import { describe, expect, it } from "vitest";
import vectors from "../fixtures/reminder-occurrences.json";
import { nextReminderOccurrence } from "@/features/reminders/scheduler";

describe("nextReminderOccurrence", () => {
  it.each(vectors)("$id keeps the send date and due date paired", (vector) => {
    expect(nextReminderOccurrence({
      rentDueDay: vector.rentDueDay,
      leadDays: vector.leadDays,
      localTime: vector.localTime,
      timezone: "America/Vancouver",
      afterInstant: vector.afterInstant
    })).toEqual({
      nextRunAt: vector.expectedUtc,
      sendLocalDate: vector.expectedSendLocalDate,
      dueDate: vector.expectedDueDate
    });
  });

  it("makes a missed occurrence immediately eligible while its due date remains current", () => {
    expect(nextReminderOccurrence({
      rentDueDay: 1,
      leadDays: 3,
      localTime: "09:00",
      timezone: "America/Vancouver",
      afterInstant: "2026-07-30T17:00:00Z",
      catchUpBeforeDueDate: true
    })).toEqual({
      nextRunAt: "2026-07-30T17:00:00Z",
      sendLocalDate: "2026-07-30",
      dueDate: "2026-08-01"
    });
  });

  it("keeps the current payment cycle when the configured minute has just passed", () => {
    expect(nextReminderOccurrence({
      rentDueDay: 1,
      leadDays: 3,
      localTime: "04:53",
      timezone: "America/Vancouver",
      afterInstant: "2026-07-29T11:53:33Z",
      catchUpBeforeDueDate: true
    })).toEqual({
      nextRunAt: "2026-07-29T11:53:33Z",
      sendLocalDate: "2026-07-29",
      dueDate: "2026-08-01"
    });
  });

  it.each([
    { rentDueDay: 0, leadDays: 3, localTime: "09:00" },
    { rentDueDay: 32, leadDays: 3, localTime: "09:00" },
    { rentDueDay: 1, leadDays: -1, localTime: "09:00" },
    { rentDueDay: 1, leadDays: 32, localTime: "09:00" },
    { rentDueDay: 1, leadDays: 3, localTime: "24:00" }
  ])("rejects invalid scheduling input %#", (invalid) => {
    expect(() => nextReminderOccurrence({
      ...invalid,
      timezone: "America/Vancouver",
      afterInstant: "2026-07-27T20:00:00Z"
    })).toThrow();
  });
});
