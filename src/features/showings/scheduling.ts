import { Temporal } from "@js-temporal/polyfill";

export class ShowingScheduleError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

export const SHOWING_TIMEZONE = "America/Vancouver" as const;
export const SHOWING_MIN_NOTICE_HOURS = 2;
export const SHOWING_MAX_DAYS_AHEAD = 60;

export const showingTimeOptions = Array.from({ length: 19 }, (_, index) => {
  const totalMinutes = 9 * 60 + index * 30;
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  const value = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  const label = new Intl.DateTimeFormat("en-CA", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "UTC"
  }).format(new Date(`2020-01-01T${value}:00Z`));
  return { value, label };
});

function plainDateFromInstant(now: Temporal.Instant) {
  return now.toZonedDateTimeISO(SHOWING_TIMEZONE).toPlainDate();
}

export function showingDateBounds(now: Temporal.Instant = Temporal.Now.instant()) {
  const minimum = plainDateFromInstant(now);
  return {
    minimum: minimum.toString(),
    maximum: minimum.add({ days: SHOWING_MAX_DAYS_AHEAD }).toString()
  };
}

export function resolveShowingSlot(
  input: { requestedLocalDate: string; requestedLocalTime: string; timezone: string },
  now: Temporal.Instant = Temporal.Now.instant()
) {
  if (input.timezone !== SHOWING_TIMEZONE) {
    throw new ShowingScheduleError("SHOWING_TIMEZONE_INVALID", "Showing times must use Pacific Time.");
  }

  let date: Temporal.PlainDate;
  let time: Temporal.PlainTime;
  let start: Temporal.ZonedDateTime;
  try {
    date = Temporal.PlainDate.from(input.requestedLocalDate);
    time = Temporal.PlainTime.from(input.requestedLocalTime);
    start = date.toZonedDateTime({ timeZone: SHOWING_TIMEZONE, plainTime: time });
  } catch {
    throw new ShowingScheduleError("SHOWING_TIME_INVALID", "Choose a valid showing date and time.");
  }

  if (date.dayOfWeek === 7) {
    throw new ShowingScheduleError("SHOWING_DAY_UNAVAILABLE", "Sunday showings are unavailable. Choose Monday through Saturday.");
  }

  const slotMinutes = time.hour * 60 + time.minute;
  if (time.second !== 0 || time.millisecond !== 0 || slotMinutes < 9 * 60 || slotMinutes > 18 * 60 || slotMinutes % 30 !== 0) {
    throw new ShowingScheduleError("SHOWING_SLOT_UNAVAILABLE", "Choose an available time between 9:00 AM and 6:00 PM.");
  }

  const bounds = showingDateBounds(now);
  if (Temporal.PlainDate.compare(date, Temporal.PlainDate.from(bounds.minimum)) < 0) {
    throw new ShowingScheduleError("SHOWING_TIME_PAST", "Choose a future showing time.");
  }
  if (Temporal.PlainDate.compare(date, Temporal.PlainDate.from(bounds.maximum)) > 0) {
    throw new ShowingScheduleError("SHOWING_TIME_TOO_FAR", "Choose a showing within the next 60 days.");
  }
  if (Temporal.Instant.compare(start.toInstant(), now.add({ hours: SHOWING_MIN_NOTICE_HOURS })) < 0) {
    throw new ShowingScheduleError("SHOWING_NOTICE_REQUIRED", "Please allow at least two hours before the requested showing time.");
  }

  return {
    requestedStartAt: start.toInstant().toString(),
    requestedLocalDate: date.toString(),
    requestedLocalTime: time.toString({ smallestUnit: "minute" }),
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
