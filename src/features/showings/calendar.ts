import { Temporal } from "@js-temporal/polyfill";
import type { ViewingScheduleInput } from "@/features/showings/availability";

export interface ViewingDateWindow {
  minimum: string;
  maximum: string; // Exclusive, matching the public booking window.
}

export function calendarMonthDays(month: string) {
  const first = Temporal.PlainDate.from(`${month}-01`);
  const cells: Array<string | null> = Array.from({ length: first.dayOfWeek - 1 }, () => null);
  for (let day = 1; day <= first.daysInMonth; day++) cells.push(first.with({ day }).toString());
  while (cells.length % 7) cells.push(null);
  return cells;
}

export function formatCalendarDate(date: string, compact = false) {
  return new Intl.DateTimeFormat("en-CA", {
    weekday: compact ? "short" : "long", month: compact ? "short" : "long", day: "numeric",
    ...(compact ? {} : { year: "numeric" }), timeZone: "UTC"
  }).format(new Date(`${date}T12:00:00Z`));
}

export function selectedViewingDates(schedule: ViewingScheduleInput, window: ViewingDateWindow) {
  const selected: string[] = [];
  for (let date = Temporal.PlainDate.from(window.minimum); date.toString() < window.maximum; date = date.add({ days: 1 })) {
    const available = schedule.dateOverrides.find((entry) => entry.date === date.toString())?.available
      ?? schedule.openWeekdays.includes(date.dayOfWeek);
    if (available) selected.push(date.toString());
  }
  return selected;
}

export function calendarScheduleInput(
  schedule: ViewingScheduleInput, selectedDates: string[], window: ViewingDateWindow
): ViewingScheduleInput {
  return {
    timezone: schedule.timezone,
    openWeekdays: [],
    dateOverrides: [
      // Keep explicitly scheduled future dates. Past settings do not affect bookings.
      ...schedule.dateOverrides.filter((entry) => entry.date >= window.maximum && entry.available),
      ...[...new Set(selectedDates)].filter((date) => date >= window.minimum && date < window.maximum)
        .map((date) => ({ date, available: true }))
    ].sort((left, right) => left.date.localeCompare(right.date))
  };
}
