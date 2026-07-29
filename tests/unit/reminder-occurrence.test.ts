import { describe, expect, it } from "vitest";
import vectors from "../fixtures/reminder-occurrences.json";
import {
  nextReminderOccurrence,
  previewReminderOccurrence
} from "@/features/reminders/scheduler";

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

  it("keeps a missed occurrence eligible at its planned time while its due date remains current", () => {
    expect(nextReminderOccurrence({
      rentDueDay: 1,
      leadDays: 3,
      localTime: "09:00",
      timezone: "America/Vancouver",
      afterInstant: "2026-07-30T17:00:00Z",
      catchUpBeforeDueDate: true
    })).toEqual({
      nextRunAt: "2026-07-29T16:00:00Z",
      sendLocalDate: "2026-07-29",
      dueDate: "2026-08-01"
    });
  });

  it("keeps the current payment cycle when the configured minute has just passed", () => {
    expect(previewReminderOccurrence({
      rentDueDay: 1,
      moveInDate: "2026-07-01",
      leadDays: 3,
      localTime: "04:53",
      timezone: "America/Vancouver",
      afterInstant: "2026-07-29T11:53:33Z"
    })).toEqual({
      nextRunAt: "2026-07-29T11:53:00Z",
      sendLocalDate: "2026-07-29",
      dueDate: "2026-08-01"
    });
  });

  it("starts recurring rent with the first due date strictly after move-in", () => {
    expect(previewReminderOccurrence({
      rentDueDay: 1,
      moveInDate: "2031-08-01",
      leadDays: 3,
      localTime: "09:00",
      timezone: "America/Vancouver",
      afterInstant: "2026-07-29T15:00:00Z"
    })).toEqual({
      nextRunAt: "2031-08-29T16:00:00Z",
      sendLocalDate: "2031-08-29",
      dueDate: "2031-09-01"
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
