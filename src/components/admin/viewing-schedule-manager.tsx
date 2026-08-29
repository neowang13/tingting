"use client";

import { CalendarClock, Plus, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { ViewingSchedule } from "@/features/showings/availability";

const days = [
  { weekday: 1, label: "Monday" },
  { weekday: 2, label: "Tuesday" },
  { weekday: 3, label: "Wednesday" },
  { weekday: 4, label: "Thursday" },
  { weekday: 5, label: "Friday" },
  { weekday: 6, label: "Saturday" },
  { weekday: 7, label: "Sunday" }
] as const;

function sortTimes(times: string[]) {
  return [...new Set(times)].sort((left, right) => left.localeCompare(right));
}

function weekdayForDate(date: string) {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

export function ViewingScheduleManager({ initialSchedule }: { initialSchedule: ViewingSchedule }) {
  const [schedule, setSchedule] = useState(initialSchedule);
  const [weeklyDrafts, setWeeklyDrafts] = useState<Record<number, string>>({});
  const [overrideDate, setOverrideDate] = useState("");
  const [overrideTimes, setOverrideTimes] = useState<string[]>([]);
  const [overrideTimeDraft, setOverrideTimeDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; message: string } | null>(null);

  const overrides = useMemo(
    () => [...schedule.dateOverrides].sort((left, right) => left.date.localeCompare(right.date)),
    [schedule.dateOverrides]
  );

  function weeklyTimes(weekday: number) {
    return schedule.weeklySlots.find((entry) => entry.weekday === weekday)?.times ?? [];
  }

  function setWeeklyTimes(weekday: number, times: string[]) {
    setSchedule((current) => ({
      ...current,
      weeklySlots: [
        ...current.weeklySlots.filter((entry) => entry.weekday !== weekday),
        { weekday, times: sortTimes(times) }
      ].sort((left, right) => left.weekday - right.weekday)
    }));
  }

  function chooseOverrideDate(date: string) {
    setOverrideDate(date);
    const existing = schedule.dateOverrides.find((entry) => entry.date === date);
    setOverrideTimes(existing ? [...existing.times] : date ? [...weeklyTimes(weekdayForDate(date))] : []);
    setOverrideTimeDraft("");
  }

  function applyOverride(times: string[]) {
    if (!overrideDate) return;
    setSchedule((current) => ({
      ...current,
      dateOverrides: [
        ...current.dateOverrides.filter((entry) => entry.date !== overrideDate),
        { date: overrideDate, times: sortTimes(times) }
      ]
    }));
    setOverrideTimes(sortTimes(times));
    setNotice(null);
  }

  async function save() {
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch("/api/admin/viewing-schedule", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          timezone: schedule.timezone,
          weeklySlots: schedule.weeklySlots,
          dateOverrides: schedule.dateOverrides,
          expectedUpdatedAt: schedule.updatedAt
        })
      });
      const body = await response.json() as { data?: ViewingSchedule; error?: { message?: string } };
      if (!response.ok || !body.data) throw new Error(body.error?.message || "Viewing dates could not be saved.");
      setSchedule(body.data);
      setNotice({ tone: "success", message: "Viewing dates published. The public booking form now uses this schedule." });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Viewing dates could not be saved." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="prototype-page viewing-schedule-page">
      <section className="client-panel viewing-schedule-intro">
        <CalendarClock aria-hidden />
        <div>
          <h2>Public viewing availability</h2>
          <p>Weekly times repeat automatically. Date changes replace the weekly times for one specific day. Visitors only see open spots during the next month.</p>
        </div>
      </section>

      <section className="client-panel">
        <div className="viewing-section-heading">
          <div><h2>Weekly viewing times</h2><p>Add every appointment start time that should repeat each week.</p></div>
        </div>
        <div className="viewing-weekly-list">
          {days.map((day) => {
            const times = weeklyTimes(day.weekday);
            return <div className="viewing-day-row" key={day.weekday}>
              <strong>{day.label}</strong>
              <div className="viewing-time-list">
                {times.map((time) => <span className="viewing-time-pill" key={time}>{time}<button type="button" aria-label={`Remove ${time} on ${day.label}`} onClick={() => setWeeklyTimes(day.weekday, times.filter((item) => item !== time))}><X size={13} aria-hidden /></button></span>)}
                {times.length === 0 && <small>Closed</small>}
              </div>
              <div className="viewing-add-time">
                <input aria-label={`New ${day.label} viewing time`} type="time" value={weeklyDrafts[day.weekday] ?? ""} onChange={(event) => setWeeklyDrafts((current) => ({ ...current, [day.weekday]: event.target.value }))} />
                <button className="button secondary" type="button" disabled={!weeklyDrafts[day.weekday]} onClick={() => {
                  setWeeklyTimes(day.weekday, [...times, weeklyDrafts[day.weekday]]);
                  setWeeklyDrafts((current) => ({ ...current, [day.weekday]: "" }));
                }}><Plus size={14} aria-hidden />Add</button>
              </div>
            </div>;
          })}
        </div>
      </section>

      <section className="client-panel">
        <div className="viewing-section-heading"><div><h2>Change one date</h2><p>Use this for holidays, cancellations, or a different set of times on a particular date.</p></div></div>
        <div className="viewing-override-editor">
          <label className="field"><span>Date</span><input type="date" value={overrideDate} onChange={(event) => chooseOverrideDate(event.target.value)} /></label>
          <div className="viewing-time-list">
            {overrideTimes.map((time) => <span className="viewing-time-pill" key={time}>{time}<button type="button" aria-label={`Remove ${time} from date change`} onClick={() => setOverrideTimes((current) => current.filter((item) => item !== time))}><X size={13} aria-hidden /></button></span>)}
            {overrideDate && overrideTimes.length === 0 && <small>This date will be closed.</small>}
          </div>
          <div className="viewing-add-time">
            <input aria-label="New date-specific viewing time" type="time" value={overrideTimeDraft} onChange={(event) => setOverrideTimeDraft(event.target.value)} disabled={!overrideDate} />
            <button className="button secondary" type="button" disabled={!overrideDate || !overrideTimeDraft} onClick={() => {
              setOverrideTimes((current) => sortTimes([...current, overrideTimeDraft]));
              setOverrideTimeDraft("");
            }}><Plus size={14} aria-hidden />Add time</button>
            <button className="button secondary" type="button" disabled={!overrideDate} onClick={() => applyOverride([])}>Close date</button>
            <button className="button" type="button" disabled={!overrideDate} onClick={() => applyOverride(overrideTimes)}>Apply date change</button>
          </div>
        </div>

        {overrides.length > 0 && <div className="viewing-overrides-list">
          <h3>Scheduled date changes</h3>
          {overrides.map((override) => <div key={override.date}>
            <strong>{override.date}</strong>
            <span>{override.times.length ? override.times.join(", ") : "Closed"}</span>
            <button className="button secondary" type="button" onClick={() => chooseOverrideDate(override.date)}>Edit</button>
            <button className="button secondary" type="button" onClick={() => setSchedule((current) => ({ ...current, dateOverrides: current.dateOverrides.filter((entry) => entry.date !== override.date) }))}>Use weekly times</button>
          </div>)}
        </div>}
      </section>

      <section className="viewing-publish-bar">
        <div><strong>Publishing changes the booking choices immediately.</strong><span>Existing confirmed appointments keep their booked time.</span></div>
        <button className="button" type="button" disabled={busy} onClick={save}>{busy ? "Publishing…" : "Publish viewing dates"}</button>
      </section>
      {notice && <div className={`form-status ${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>{notice.message}</div>}
    </div>
  );
}
