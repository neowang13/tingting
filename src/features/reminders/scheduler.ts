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

export interface NextReminderOccurrenceInput {
  rentDueDay: number;
  /**
   * The first rent payment is treated as part of move-in. Recurring reminders
   * therefore start with the first payment date strictly after this date.
   */
  moveInDate?: string | null;
  leadDays: number;
  localTime: string;
  timezone: string;
  afterInstant: string;
  /**
   * Used only when a tenant becomes newly eligible. Normal schedule
   * recalculation deliberately skips an occurrence whose planned send time
   * has already passed.
   */
  catchUpBeforeDueDate?: boolean;
}

export interface ReminderOccurrence {
  nextRunAt: string;
  sendLocalDate: string;
  dueDate: string;
}

/**
 * Returns the payment cycle that an administrator should see in a preview,
 * while preserving the configured wall-clock send time. A catch-up occurrence
 * may be due immediately, but displaying the refresh instant as the scheduled
 * time would make the preview drift every time the page reloads.
 */
export function previewReminderOccurrence(
  input: Omit<NextReminderOccurrenceInput, "catchUpBeforeDueDate">
): ReminderOccurrence {
  const occurrence = nextReminderOccurrence({
    ...input,
    catchUpBeforeDueDate: true
  });
  const dueDate = Temporal.PlainDate.from(occurrence.dueDate);
  const sendLocalDate = dueDate.subtract({ days: input.leadDays });
  const [hour, minute] = input.localTime.split(":").map(Number);
  const planned = sendLocalDate
    .toPlainDateTime({ hour, minute })
    .toZonedDateTime(input.timezone, { disambiguation: "compatible" })
    .toInstant();

  return {
    nextRunAt: planned.toString(),
    sendLocalDate: sendLocalDate.toString(),
    dueDate: dueDate.toString()
  };
}

/**
 * Calculates the send instant and the rent due date as one indivisible
 * occurrence. Keeping both values together prevents a cross-month reminder
 * from rendering the wrong month's due date.
 */
export function nextReminderOccurrence(
  input: NextReminderOccurrenceInput
): ReminderOccurrence {
  const after = Temporal.Instant.from(input.afterInstant);
  const localAfter = after.toZonedDateTimeISO(input.timezone);
  const moveInDate = input.moveInDate
    ? Temporal.PlainDate.from(input.moveInDate)
    : null;
  const afterMonth = localAfter.toPlainDate().with({ day: 1 });
  const moveInMonth = moveInDate?.with({ day: 1 }) ?? null;
  const firstMonth =
    moveInMonth && Temporal.PlainDate.compare(moveInMonth, afterMonth) > 0
      ? moveInMonth
      : afterMonth;
  const [hour, minute] = input.localTime.split(":").map(Number);

  if (!Number.isInteger(input.rentDueDay) || input.rentDueDay < 1 || input.rentDueDay > 31) {
    throw new RangeError("rentDueDay must be an integer from 1 to 31.");
  }
  if (!Number.isInteger(input.leadDays) || input.leadDays < 0 || input.leadDays > 31) {
    throw new RangeError("leadDays must be an integer from 0 to 31.");
  }
  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    throw new RangeError("localTime must use a valid HH:mm value.");
  }

  for (let offset = 0; offset < 36; offset += 1) {
    const month = firstMonth.add({ months: offset });
    const dueDate = month.with({
      day: Math.min(input.rentDueDay, month.daysInMonth)
    });
    if (
      moveInDate &&
      Temporal.PlainDate.compare(dueDate, moveInDate) <= 0
    ) {
      continue;
    }
    const sendDate = dueDate.subtract({ days: input.leadDays });
    const sendDateTime = sendDate.toPlainDateTime({ hour, minute });
    const planned = sendDateTime
      .toZonedDateTime(input.timezone, { disambiguation: "compatible" })
      .toInstant();

    if (Temporal.Instant.compare(planned, after) > 0) {
      return {
        nextRunAt: planned.toString(),
        sendLocalDate: sendDate.toString(),
        dueDate: dueDate.toString()
      };
    }

    if (
      input.catchUpBeforeDueDate &&
      Temporal.PlainDate.compare(localAfter.toPlainDate(), dueDate) <= 0
    ) {
      return {
        nextRunAt: planned.toString(),
        sendLocalDate: sendDate.toString(),
        dueDate: dueDate.toString()
      };
    }
  }

  throw new Error("Unable to calculate the next reminder occurrence.");
}
