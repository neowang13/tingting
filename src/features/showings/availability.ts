import { createClient } from "@supabase/supabase-js";
import { Temporal } from "@js-temporal/polyfill";
import { ApiError } from "@/lib/api";
import {
  SHOWING_MIN_NOTICE_HOURS,
  SHOWING_TIMEZONE,
  showingDateBounds
} from "@/features/showings/scheduling";

export interface ViewingWeeklySlot {
  weekday: number;
  times: string[];
}

export interface ViewingDateOverride {
  date: string;
  times: string[];
}

export interface ViewingSchedule {
  timezone: typeof SHOWING_TIMEZONE;
  weeklySlots: ViewingWeeklySlot[];
  dateOverrides: ViewingDateOverride[];
  updatedAt: string;
}

export interface ViewingScheduleInput {
  timezone: string;
  weeklySlots: ViewingWeeklySlot[];
  dateOverrides: ViewingDateOverride[];
}

interface AcceptedShowingRow {
  requested_start_at: string;
}

declare global {
  var __tingtingViewingSchedule: ViewingSchedule | undefined;
  var __tingtingViewingAvailabilityCache: {
    expiresAt: number;
    value: PublicViewingAvailability;
  } | undefined;
  var __tingtingViewingAvailabilityInflight: Promise<PublicViewingAvailability> | undefined;
  var __tingtingViewingAvailabilityGeneration: number | undefined;
}

export interface PublicViewingAvailability {
  window: { start: string; end: string; timezone: typeof SHOWING_TIMEZONE };
  dates: Array<{ date: string; label: string; spots: Array<{ time: string; label: string }> }>;
}

const DEFAULT_WEEKLY_TIMES = ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00", "12:30", "13:00", "13:30", "14:00", "14:30", "15:00", "15:30", "16:00", "16:30", "17:00", "17:30", "18:00"];

function defaultSchedule(): ViewingSchedule {
  return {
    timezone: SHOWING_TIMEZONE,
    weeklySlots: [1, 2, 3, 4, 5, 6].map((weekday) => ({
      weekday,
      times: [...DEFAULT_WEEKLY_TIMES]
    })),
    dateOverrides: [],
    updatedAt: new Date().toISOString()
  };
}

function cloneSchedule(schedule: ViewingSchedule) {
  return structuredClone(schedule);
}

function supabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new ApiError(503, "VIEWING_SCHEDULE_UNAVAILABLE", "The viewing schedule is temporarily unavailable.");
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

function validTime(value: unknown): value is string {
  if (typeof value !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return false;
  try {
    return Temporal.PlainTime.from(value).toString({ smallestUnit: "minute" }) === value;
  } catch {
    return false;
  }
}

function normalizeTimes(value: unknown, field: string) {
  if (!Array.isArray(value) || value.length > 48 || !value.every(validTime)) {
    throw new ApiError(400, "VIEWING_SCHEDULE_INVALID", `${field} must contain valid 24-hour times.`);
  }
  return [...new Set(value)].sort();
}

function normalizeScheduleInput(input: ViewingScheduleInput) {
  if (!input || input.timezone !== SHOWING_TIMEZONE) {
    throw new ApiError(400, "VIEWING_SCHEDULE_INVALID", "Viewing times must use America/Vancouver.");
  }
  if (!Array.isArray(input.weeklySlots) || input.weeklySlots.length > 7) {
    throw new ApiError(400, "VIEWING_SCHEDULE_INVALID", "Weekly slots must use ISO weekdays 1 through 7.");
  }
  if (!Array.isArray(input.dateOverrides) || input.dateOverrides.length > 366) {
    throw new ApiError(400, "VIEWING_SCHEDULE_INVALID", "Too many viewing date overrides were provided.");
  }

  const weekdays = new Set<number>();
  const weeklySlots = input.weeklySlots.map((entry, index) => {
    if (!entry || !Number.isInteger(entry.weekday) || entry.weekday < 1 || entry.weekday > 7 || weekdays.has(entry.weekday)) {
      throw new ApiError(400, "VIEWING_SCHEDULE_INVALID", "Each ISO weekday may appear once and must be between 1 and 7.");
    }
    weekdays.add(entry.weekday);
    return {
      weekday: entry.weekday,
      times: normalizeTimes(entry.times, `weeklySlots[${index}].times`)
    };
  }).sort((left, right) => left.weekday - right.weekday);

  const dates = new Set<string>();
  const dateOverrides = input.dateOverrides.map((entry, index) => {
    let date: string;
    try {
      date = Temporal.PlainDate.from(entry?.date).toString();
    } catch {
      throw new ApiError(400, "VIEWING_SCHEDULE_INVALID", `dateOverrides[${index}].date must be a valid date.`);
    }
    if (date !== entry.date || dates.has(date)) {
      throw new ApiError(400, "VIEWING_SCHEDULE_INVALID", "Each override date must be unique and use YYYY-MM-DD.");
    }
    dates.add(date);
    return {
      date,
      times: normalizeTimes(entry.times, `dateOverrides[${index}].times`)
    };
  }).sort((left, right) => left.date.localeCompare(right.date));

  return { timezone: SHOWING_TIMEZONE, weeklySlots, dateOverrides };
}

function mapScheduleRow(row: {
  timezone: string;
  weekly_slots: unknown;
  date_overrides: unknown;
  updated_at: string;
}): ViewingSchedule {
  const normalized = normalizeScheduleInput({
    timezone: row.timezone,
    weeklySlots: row.weekly_slots as ViewingWeeklySlot[],
    dateOverrides: row.date_overrides as ViewingDateOverride[]
  });
  return { ...normalized, updatedAt: row.updated_at };
}

export async function getViewingSchedule(): Promise<ViewingSchedule> {
  if (process.env.DATA_BACKEND !== "supabase") {
    globalThis.__tingtingViewingSchedule ??= defaultSchedule();
    return cloneSchedule(globalThis.__tingtingViewingSchedule);
  }

  const { data, error } = await supabaseClient()
    .from("viewing_schedules")
    .select("timezone, weekly_slots, date_overrides, updated_at")
    .eq("id", 1)
    .single();
  if (error || !data) {
    throw new ApiError(503, "VIEWING_SCHEDULE_UNAVAILABLE", "The viewing schedule is temporarily unavailable.");
  }
  return mapScheduleRow(data);
}

function nextMemoryUpdatedAt(previous: string) {
  const now = new Date().toISOString();
  if (now !== previous) return now;
  return new Date(new Date(previous).getTime() + 1).toISOString();
}

export async function saveViewingSchedule(
  input: ViewingScheduleInput,
  expectedUpdatedAt?: string
): Promise<ViewingSchedule> {
  const normalized = normalizeScheduleInput(input);
  if (process.env.DATA_BACKEND !== "supabase") {
    globalThis.__tingtingViewingSchedule ??= defaultSchedule();
    if (expectedUpdatedAt && globalThis.__tingtingViewingSchedule.updatedAt !== expectedUpdatedAt) {
      throw new ApiError(409, "VIEWING_SCHEDULE_CONFLICT", "The viewing schedule changed. Reload it and try again.");
    }
    const saved = {
      ...normalized,
      updatedAt: nextMemoryUpdatedAt(globalThis.__tingtingViewingSchedule.updatedAt)
    };
    globalThis.__tingtingViewingSchedule = saved;
    invalidateViewingAvailabilityCache();
    return cloneSchedule(saved);
  }

  const client = supabaseClient();
  const updatedAt = new Date().toISOString();
  let query = client
    .from("viewing_schedules")
    .update({
      timezone: normalized.timezone,
      weekly_slots: normalized.weeklySlots,
      date_overrides: normalized.dateOverrides,
      updated_at: updatedAt
    })
    .eq("id", 1);
  if (expectedUpdatedAt) query = query.eq("updated_at", expectedUpdatedAt);
  const { data, error } = await query
    .select("timezone, weekly_slots, date_overrides, updated_at")
    .maybeSingle();
  if (error) {
    throw new ApiError(503, "VIEWING_SCHEDULE_UNAVAILABLE", "The viewing schedule could not be saved.");
  }
  if (!data) {
    throw new ApiError(409, "VIEWING_SCHEDULE_CONFLICT", "The viewing schedule changed. Reload it and try again.");
  }
  const saved = mapScheduleRow(data);
  invalidateViewingAvailabilityCache();
  return saved;
}

export function invalidateViewingAvailabilityCache() {
  globalThis.__tingtingViewingAvailabilityCache = undefined;
  globalThis.__tingtingViewingAvailabilityInflight = undefined;
  globalThis.__tingtingViewingAvailabilityGeneration =
    (globalThis.__tingtingViewingAvailabilityGeneration ?? 0) + 1;
}

function timesForDate(schedule: ViewingSchedule, date: Temporal.PlainDate) {
  const dateString = date.toString();
  const override = schedule.dateOverrides.find((entry) => entry.date === dateString);
  return override?.times ?? schedule.weeklySlots.find((entry) => entry.weekday === date.dayOfWeek)?.times ?? [];
}

function localMidnight(date: Temporal.PlainDate) {
  return date.toZonedDateTime({
    timeZone: SHOWING_TIMEZONE,
    plainTime: Temporal.PlainTime.from("00:00")
  }).toInstant();
}

async function acceptedStarts(start: Temporal.PlainDate, end: Temporal.PlainDate) {
  if (process.env.DATA_BACKEND !== "supabase") {
    return new Set((globalThis.__tingtingShowingRequests ?? [])
      .filter((request) => request.status === "accepted")
      .map((request) => Temporal.Instant.from(request.requestedStartAt).toString()));
  }

  const { data, error } = await supabaseClient()
    .from("showing_requests")
    .select("requested_start_at")
    .eq("status", "accepted")
    .gte("requested_start_at", localMidnight(start).toString())
    .lt("requested_start_at", localMidnight(end).toString());
  if (error) {
    throw new ApiError(503, "VIEWING_AVAILABILITY_UNAVAILABLE", "Viewing availability is temporarily unavailable.");
  }
  return new Set(((data ?? []) as AcceptedShowingRow[])
    .map((row) => Temporal.Instant.from(row.requested_start_at).toString()));
}

function dateLabel(date: Temporal.PlainDate) {
  return new Intl.DateTimeFormat("en-CA", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC"
  }).format(new Date(`${date.toString()}T12:00:00Z`));
}

function timeLabel(time: string) {
  return new Intl.DateTimeFormat("en-CA", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "UTC"
  }).format(new Date(`2020-01-01T${time}:00Z`));
}

async function calculatePublicViewingAvailability(now: Temporal.Instant): Promise<PublicViewingAvailability> {
  const schedule = await getViewingSchedule();
  const bounds = showingDateBounds(now);
  const start = Temporal.PlainDate.from(bounds.minimum);
  const end = Temporal.PlainDate.from(bounds.maximum);
  const booked = await acceptedStarts(start, end);
  const noticeBoundary = now.add({ hours: SHOWING_MIN_NOTICE_HOURS });
  const dates: Array<{ date: string; label: string; spots: Array<{ time: string; label: string }> }> = [];

  for (let date = start; Temporal.PlainDate.compare(date, end) < 0; date = date.add({ days: 1 })) {
    const spots = timesForDate(schedule, date).flatMap((time) => {
      const zonedStart = date.toZonedDateTime({
        timeZone: schedule.timezone,
        plainTime: Temporal.PlainTime.from(time)
      });
      if (
        !zonedStart.toPlainDate().equals(date) ||
        zonedStart.toPlainTime().toString({ smallestUnit: "minute" }) !== time
      ) return [];
      const startAt = zonedStart.toInstant();
      if (Temporal.Instant.compare(startAt, noticeBoundary) < 0 || booked.has(startAt.toString())) return [];
      return [{ time, label: timeLabel(time) }];
    });
    if (spots.length > 0) dates.push({ date: date.toString(), label: dateLabel(date), spots });
  }

  const value: PublicViewingAvailability = {
    window: { start: start.toString(), end: end.toString(), timezone: schedule.timezone },
    dates
  };
  return value;
}

export async function listPublicViewingAvailability(now: Temporal.Instant = Temporal.Now.instant()): Promise<PublicViewingAvailability> {
  if (process.env.DATA_BACKEND !== "supabase") {
    return calculatePublicViewingAvailability(now);
  }
  if (
    globalThis.__tingtingViewingAvailabilityCache &&
    globalThis.__tingtingViewingAvailabilityCache.expiresAt > Date.now()
  ) {
    return structuredClone(globalThis.__tingtingViewingAvailabilityCache.value);
  }
  if (globalThis.__tingtingViewingAvailabilityInflight) {
    return structuredClone(await globalThis.__tingtingViewingAvailabilityInflight);
  }

  const generation = globalThis.__tingtingViewingAvailabilityGeneration ?? 0;
  const inflight = calculatePublicViewingAvailability(now)
    .then((value) => {
      if ((globalThis.__tingtingViewingAvailabilityGeneration ?? 0) === generation) {
        globalThis.__tingtingViewingAvailabilityCache = {
          expiresAt: Date.now() + 15_000,
          value: structuredClone(value)
        };
      }
      return value;
    })
    .finally(() => {
      if (globalThis.__tingtingViewingAvailabilityInflight === inflight) {
        globalThis.__tingtingViewingAvailabilityInflight = undefined;
      }
    });
  globalThis.__tingtingViewingAvailabilityInflight = inflight;
  return structuredClone(await inflight);
}
