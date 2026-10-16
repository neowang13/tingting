import { Temporal } from "@js-temporal/polyfill";
import type { ViewingScheduleInput } from "@/features/showings/availability";

export class ShowingScheduleError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}
export const SHOWING_TIMEZONE = "America/Vancouver" as const;
export const SHOWING_BOOKING_WINDOW_MONTHS = 1;
export const SHOWING_MAX_DAYS_AHEAD = 31;

export function showingDateBounds(now: Temporal.Instant = Temporal.Now.instant()) {
  const minimum = now.toZonedDateTimeISO(SHOWING_TIMEZONE).toPlainDate();
  return { minimum: minimum.toString(), maximum: minimum.add({ months: SHOWING_BOOKING_WINDOW_MONTHS }).toString() };
}

export function resolveShowingSlot(
  input: { requestedLocalDate: string; timezone: string },
  now: Temporal.Instant,
  schedule: ViewingScheduleInput
) {
  if (input.timezone !== SHOWING_TIMEZONE || schedule.timezone !== SHOWING_TIMEZONE) {
    throw new ShowingScheduleError("SHOWING_TIMEZONE_INVALID", "Viewing dates must use Pacific Time.");
  }
  let date: Temporal.PlainDate;
  try {
    date = Temporal.PlainDate.from(input.requestedLocalDate);
    if (date.toString() !== input.requestedLocalDate) throw new Error("Noncanonical date");
  } catch {
    throw new ShowingScheduleError("SHOWING_DATE_INVALID", "Choose a valid viewing date.");
  }
  const bounds = showingDateBounds(now);
  if (date.toString() < bounds.minimum) throw new ShowingScheduleError("SHOWING_DATE_PAST", "Choose today or a future viewing date.");
  if (date.toString() >= bounds.maximum) throw new ShowingScheduleError("SHOWING_DATE_TOO_FAR", "Choose a viewing within the next month.");
  const available = schedule.dateOverrides.find((entry) => entry.date === date.toString())?.available
    ?? schedule.openWeekdays.includes(date.dayOfWeek);
  if (!available) throw new ShowingScheduleError("SHOWING_DATE_UNAVAILABLE", "Choose one of this property's available viewing dates.");
  return { requestedStartAt: null, requestedLocalDate: date.toString(), requestedLocalTime: null, timezone: SHOWING_TIMEZONE };
}
