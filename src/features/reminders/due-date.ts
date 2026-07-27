import { Temporal } from "@js-temporal/polyfill";

export function rentDueDateForOccurrence(
  occurrenceLocalDate: string,
  rentDueDay: number
) {
  const occurrence = Temporal.PlainDate.from(occurrenceLocalDate);
  for (let monthOffset = 0; monthOffset <= 1; monthOffset += 1) {
    const month = occurrence.add({ months: monthOffset }).with({ day: 1 });
    const candidate = month.with({ day: Math.min(rentDueDay, month.daysInMonth) });
    if (Temporal.PlainDate.compare(candidate, occurrence) >= 0) {
      return candidate.toString();
    }
  }
  throw new Error("Unable to calculate the next rent due date.");
}

export function nextRentDueDateFromInstant(
  instant: string,
  timezone: string,
  rentDueDay: number
) {
  const localDate = Temporal.Instant.from(instant)
    .toZonedDateTimeISO(timezone)
    .toPlainDate()
    .toString();
  return rentDueDateForOccurrence(localDate, rentDueDay);
}

export function formatRentDueDate(date: string) {
  return Temporal.PlainDate.from(date).toLocaleString("en-CA", {
    month: "long",
    day: "numeric",
    year: "numeric"
  });
}
