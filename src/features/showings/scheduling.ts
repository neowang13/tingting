import { Temporal } from "@js-temporal/polyfill";
import type { ViewingSchedule } from "@/features/showings/availability";

export class ShowingScheduleError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

export const SHOWING_TIMEZONE = "America/Vancouver" as const;
export const SHOWING_MIN_NOTICE_HOURS = 2;
export const SHOWING_BOOKING_WINDOW_MONTHS = 1;

// Kept temporarily for callers that still render the former day-based hint.
// Scheduling itself uses a calendar month, not a fixed number of days.
export const SHOWING_MAX_DAYS_AHEAD = 31;

function plainDateFromInstant(now: Temporal.Instant) {
  return now.toZonedDateTimeISO(SHOWING_TIMEZONE).toPlainDate();
}

export function showingDateBounds(now: Temporal.Instant = Temporal.Now.instant()) {
  const minimum = plainDateFromInstant(now);
  return {
    minimum: minimum.toString(),
    maximum: minimum.add({ months: SHOWING_BOOKING_WINDOW_MONTHS }).toString()
  };
}

function configuredTimesForDate(date: Temporal.PlainDate, schedule: ViewingSchedule) {
  const override = schedule.dateOverrides.find((entry) => entry.date === date.toString());
  if (override) return override.times;
  return schedule.weeklySlots.find((entry) => entry.weekday === date.dayOfWeek)?.times ?? [];
}

export function resolveShowingSlot(
  input: { requestedLocalDate: string; requestedLocalTime: string; timezone: string },
  now: Temporal.Instant,
  schedule: ViewingSchedule
) {
  if (input.timezone !== SHOWING_TIMEZONE || schedule.timezone !== SHOWING_TIMEZONE) {
    throw new ShowingScheduleError("SHOWING_TIMEZONE_INVALID", "Viewing times must use Pacific Time.");
  }

  let date: Temporal.PlainDate;
  let time: Temporal.PlainTime;
  let start: Temporal.ZonedDateTime;
  try {
    date = Temporal.PlainDate.from(input.requestedLocalDate);
    time = Temporal.PlainTime.from(input.requestedLocalTime);
    start = date.toZonedDateTime({ timeZone: schedule.timezone, plainTime: time });
  } catch {
    throw new ShowingScheduleError("SHOWING_TIME_INVALID", "Choose a valid viewing date and time.");
  }

  const bounds = showingDateBounds(now);
  if (Temporal.PlainDate.compare(date, Temporal.PlainDate.from(bounds.minimum)) < 0) {
    throw new ShowingScheduleError("SHOWING_TIME_PAST", "Choose a future viewing time.");
  }
  if (Temporal.PlainDate.compare(date, Temporal.PlainDate.from(bounds.maximum)) >= 0) {
    throw new ShowingScheduleError("SHOWING_TIME_TOO_FAR", "Choose a viewing within the next month.");
  }

  const requestedTime = time.toString({ smallestUnit: "minute" });
  if (
    time.second !== 0 ||
    time.millisecond !== 0 ||
    time.microsecond !== 0 ||
    time.nanosecond !== 0 ||
    !configuredTimesForDate(date, schedule).includes(requestedTime)
  ) {
    throw new ShowingScheduleError("SHOWING_SLOT_UNAVAILABLE", "Choose one of the available viewing times.");
  }
  if (
    !start.toPlainDate().equals(date) ||
    start.toPlainTime().toString({ smallestUnit: "minute" }) !== requestedTime
  ) {
    throw new ShowingScheduleError("SHOWING_TIME_INVALID", "That local time does not exist because of the daylight-saving change.");
  }

  if (Temporal.Instant.compare(start.toInstant(), now.add({ hours: SHOWING_MIN_NOTICE_HOURS })) < 0) {
    throw new ShowingScheduleError("SHOWING_NOTICE_REQUIRED", "Please allow at least two hours before the viewing time.");
  }

  return {
    requestedStartAt: start.toInstant().toString(),
    requestedLocalDate: date.toString(),
    requestedLocalTime: requestedTime,
    timezone: SHOWING_TIMEZONE
  };
}

export function formatShowingSlot(input: {
  requestedStartAt: string;
  timezone?: string;
}) {
  return new Intl.DateTimeFormat("en-CA", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone: input.timezone ?? SHOWING_TIMEZONE
  }).format(new Date(input.requestedStartAt));
}
