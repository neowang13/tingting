"use client";

import { CalendarClock, X } from "lucide-react";
import { formatCalendarDate, type ViewingDateWindow } from "@/features/showings/calendar";
import { DateCalendar } from "@/components/shared/date-calendar";

export function ViewingScheduleManager({ selectedDates, dateWindow, onChange, busy }: {
  selectedDates: string[];
  dateWindow: ViewingDateWindow;
  onChange: (dates: string[]) => void;
  busy: boolean;
}) {
  function toggleDate(date: string) {
    onChange(selectedDates.includes(date) ? selectedDates.filter((entry) => entry !== date) : [...selectedDates, date].sort());
  }

  return <section id="property-viewing-dates" className="prototype-page viewing-schedule-page" aria-labelledby="viewing-dates-heading">
    <div className="client-panel viewing-schedule-intro">
      <CalendarClock aria-hidden />
      <div><h2 id="viewing-dates-heading">Viewing dates</h2><p>Choose the dates visitors can book for this property. Multiple groups can book each date; an agent arranges the time.</p></div>
    </div>
    <div className="client-panel">
      <div className="viewing-calendar-heading"><h3>Choose viewing dates</h3><p>Click a date to select it. Click again to remove it. Use the property’s Publish button to make your selected dates available to visitors.</p></div>
      <DateCalendar label="Select viewing dates" minimum={dateWindow.minimum} maximum={dateWindow.maximum}
        selectedDates={selectedDates} onSelect={toggleDate} disabled={busy} />
      <div className="viewing-calendar-legend"><span><i aria-hidden />Selected date</span><span>Pacific Time · bookings for the next month</span></div>
      <div className="viewing-selected-heading">
        <strong role="status" aria-live="polite">{selectedDates.length} {selectedDates.length === 1 ? "date" : "dates"} selected</strong>
        {selectedDates.length > 0 && <button className="text-button" type="button" disabled={busy} onClick={() => onChange([])}>Clear selection</button>}
      </div>
      {selectedDates.length > 0 ? <div className="viewing-selected-dates">
        {selectedDates.map((date) => <button type="button" className="viewing-selected-date" key={date} disabled={busy}
          aria-label={`Remove ${formatCalendarDate(date)}`} onClick={() => toggleDate(date)}>
          {formatCalendarDate(date, true)}<X size={14} aria-hidden />
        </button>)}
      </div> : <p>No dates selected. Visitors cannot book a viewing until you select at least one date and publish this property.</p>}
    </div>
  </section>;
}
