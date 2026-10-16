"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Temporal } from "@js-temporal/polyfill";
import { useId, useRef, useState, type KeyboardEvent } from "react";
import { calendarMonthDays, formatCalendarDate } from "@/features/showings/calendar";

interface Props {
  label: string;
  minimum: string;
  maximum: string;
  selectedDates: string[];
  availableDates?: string[];
  onSelect: (date: string) => void;
  disabled?: boolean;
}

const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function DateCalendar({ label, minimum, maximum, selectedDates, availableDates, onSelect, disabled = false }: Props) {
  const [month, setMonth] = useState(minimum.slice(0, 7));
  const monthHeadingId = useId();
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const firstMonth = minimum.slice(0, 7);
  const lastMonth = Temporal.PlainDate.from(maximum).subtract({ days: 1 }).toString().slice(0, 7);
  const selected = new Set(selectedDates);
  const available = availableDates === undefined ? null : new Set(availableDates);
  const cells = calendarMonthDays(month);
  const rows = Array.from({ length: cells.length / 7 }, (_, index) => cells.slice(index * 7, index * 7 + 7));
  const monthLabel = new Intl.DateTimeFormat("en-CA", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${month}-01T12:00:00Z`));

  function canChoose(date: string) {
    return !disabled && date >= minimum && date < maximum && (!available || available.has(date));
  }

  function moveFocus(event: KeyboardEvent<HTMLButtonElement>, date: string) {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
    if (!step) return;
    event.preventDefault();
    let next = Temporal.PlainDate.from(date).add({ days: step });
    // Arrow keys stay in the displayed month; month navigation uses its own buttons.
    while (next.toString().slice(0, 7) === month && next.toString() >= minimum && next.toString() < maximum) {
      const button = buttons.current.get(next.toString());
      if (button && !button.disabled) { button.focus(); return; }
      next = next.add({ days: step });
    }
  }

  return <div className="date-calendar" role="group" aria-label={label} aria-disabled={disabled || undefined}>
    <div className="date-calendar-header">
      <button className="date-calendar-month-button" type="button" aria-label="Previous month" disabled={disabled || month <= firstMonth}
        onClick={() => setMonth(Temporal.PlainYearMonth.from(month).subtract({ months: 1 }).toString())}>
        <ChevronLeft size={18} aria-hidden />
      </button>
      <h3 id={monthHeadingId} aria-live="polite" aria-atomic="true">{monthLabel}</h3>
      <button className="date-calendar-month-button" type="button" aria-label="Next month" disabled={disabled || month >= lastMonth}
        onClick={() => setMonth(Temporal.PlainYearMonth.from(month).add({ months: 1 }).toString())}>
        <ChevronRight size={18} aria-hidden />
      </button>
    </div>
    <table className="date-calendar-grid" aria-labelledby={monthHeadingId}>
      <thead><tr>{weekdays.map((day) => <th scope="col" key={day}><abbr title={day}>{day.slice(0, 3)}</abbr></th>)}</tr></thead>
      <tbody>{rows.map((row, index) => <tr key={index}>
        {row.map((date, column) => <td key={date ?? `blank-${column}`}>
          {date && <button
            ref={(node) => { if (node) buttons.current.set(date, node); else buttons.current.delete(date); }}
            type="button"
            className={`date-calendar-day${selected.has(date) ? " is-selected" : ""}${available?.has(date) ? " is-available" : ""}`}
            data-date={date}
            aria-label={formatCalendarDate(date)}
            aria-pressed={selected.has(date)}
            disabled={!canChoose(date)}
            onClick={() => onSelect(date)}
            onKeyDown={(event) => moveFocus(event, date)}
          >{Number(date.slice(-2))}{(selected.has(date) || available?.has(date)) && <span className="date-calendar-marker" aria-hidden />}</button>}
        </td>)}
      </tr>)}</tbody>
    </table>
  </div>;
}
