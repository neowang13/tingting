import { Temporal } from "@js-temporal/polyfill";

export interface NextOccurrenceInput {
  dayOfMonth: number;
  localTime: string;
  timezone: string;
  afterInstant: string;
}

export function nextOccurrence(input: NextOccurrenceInput): string {
  const after = Temporal.Instant.from(input.afterInstant);
  const localAfter = after.toZonedDateTimeISO(input.timezone);
  const [hour, minute] = input.localTime.split(":").map(Number);

  for (let offset = 0; offset < 24; offset += 1) {
    const base = localAfter.add({ months: offset });
    const day = Math.min(input.dayOfMonth, base.daysInMonth);
    const dateTime = Temporal.PlainDateTime.from({
      year: base.year,
      month: base.month,
      day,
      hour,
      minute
    });
    const candidate = dateTime.toZonedDateTime(input.timezone, { disambiguation: "compatible" }).toInstant();
    if (Temporal.Instant.compare(candidate, after) > 0) return candidate.toString();
  }

  throw new Error("Unable to calculate the next reminder occurrence.");
}
