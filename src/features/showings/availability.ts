import { createClient } from "@supabase/supabase-js";
import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";
import { ApiError } from "@/lib/api";
import { SHOWING_TIMEZONE, showingDateBounds } from "@/features/showings/scheduling";

export const viewingScheduleInputSchema = z.object({
  timezone: z.literal(SHOWING_TIMEZONE),
  openWeekdays: z.array(z.number().int().min(1).max(7)).max(7),
  dateOverrides: z.array(z.object({
    date: z.iso.date(),
    available: z.boolean()
  }).strict()).max(366)
}).strict().superRefine((value, context) => {
  if (new Set(value.openWeekdays).size !== value.openWeekdays.length) {
    context.addIssue({ code: "custom", path: ["openWeekdays"], message: "Each weekday may appear once." });
  }
  if (new Set(value.dateOverrides.map((entry) => entry.date)).size !== value.dateOverrides.length) {
    context.addIssue({ code: "custom", path: ["dateOverrides"], message: "Each override date may appear once." });
  }
});

export type ViewingScheduleInput = z.infer<typeof viewingScheduleInputSchema>;
export interface ViewingSchedule extends ViewingScheduleInput {
  rentalListingId: string;
  updatedAt: string | null;
}
export interface PublicViewingAvailability {
  window: { start: string; end: string; timezone: typeof SHOWING_TIMEZONE };
  dates: Array<{ date: string; label: string }>;
}

declare global {
  var __tingtingPropertyViewingSchedules: Map<string, ViewingSchedule> | undefined;
}

export function viewingScheduleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new ApiError(503, "VIEWING_SCHEDULE_UNAVAILABLE", "The viewing calendar is temporarily unavailable.");
  }
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

function emptySchedule(rentalListingId: string): ViewingSchedule {
  return { rentalListingId, timezone: SHOWING_TIMEZONE, openWeekdays: [], dateOverrides: [], updatedAt: null };
}

function mapScheduleRow(row: Record<string, unknown>): ViewingSchedule {
  return {
    ...viewingScheduleInputSchema.parse({
      timezone: row.timezone,
      openWeekdays: row.open_weekdays,
      dateOverrides: row.date_overrides
    }),
    rentalListingId: String(row.rental_listing_id),
    updatedAt: String(row.updated_at)
  };
}

export async function getViewingSchedule(rentalListingId: string): Promise<ViewingSchedule> {
  if (process.env.DATA_BACKEND !== "supabase") {
    return structuredClone(globalThis.__tingtingPropertyViewingSchedules?.get(rentalListingId) ?? emptySchedule(rentalListingId));
  }
  const { data, error } = await viewingScheduleClient().from("property_viewing_schedules")
    .select("*").eq("rental_listing_id", rentalListingId).maybeSingle();
  if (error) throw new ApiError(503, "VIEWING_SCHEDULE_UNAVAILABLE", "The viewing calendar is temporarily unavailable.");
  return data ? mapScheduleRow(data) : emptySchedule(rentalListingId);
}

export async function saveViewingSchedule(
  rentalListingId: string,
  input: ViewingScheduleInput,
  expectedUpdatedAt: string | null
): Promise<ViewingSchedule> {
  const normalized = viewingScheduleInputSchema.parse(input);
  normalized.openWeekdays.sort((a, b) => a - b);
  normalized.dateOverrides.sort((a, b) => a.date.localeCompare(b.date));
  if (process.env.DATA_BACKEND !== "supabase") {
    globalThis.__tingtingPropertyViewingSchedules ??= new Map();
    const current = globalThis.__tingtingPropertyViewingSchedules.get(rentalListingId) ?? emptySchedule(rentalListingId);
    if (current.updatedAt !== expectedUpdatedAt) throw conflict();
    const previousTime = current.updatedAt ? Date.parse(current.updatedAt) : 0;
    const updatedAt = new Date(Math.max(Date.now(), previousTime + 1)).toISOString();
    const saved = { ...normalized, rentalListingId, updatedAt };
    globalThis.__tingtingPropertyViewingSchedules.set(rentalListingId, saved);
    return structuredClone(saved);
  }
  const payload = {
    rental_listing_id: rentalListingId,
    timezone: normalized.timezone,
    open_weekdays: normalized.openWeekdays,
    date_overrides: normalized.dateOverrides,
    updated_at: new Date().toISOString()
  };
  const client = viewingScheduleClient();
  const query = expectedUpdatedAt === null
    ? client.from("property_viewing_schedules").insert(payload)
    : client.from("property_viewing_schedules").update(payload)
      .eq("rental_listing_id", rentalListingId).eq("updated_at", expectedUpdatedAt);
  const { data, error } = await query.select("*").maybeSingle();
  if (error?.code === "23505" || (!error && !data)) throw conflict();
  if (error) throw new ApiError(503, "VIEWING_SCHEDULE_UNAVAILABLE", "The viewing calendar could not be saved.");
  return mapScheduleRow(data!);
}

function conflict() {
  return new ApiError(409, "VIEWING_SCHEDULE_CONFLICT", "This property's viewing calendar changed. Reload it and try again.");
}

export function isViewingDateAvailable(schedule: ViewingScheduleInput, date: Temporal.PlainDate) {
  return schedule.dateOverrides.find((entry) => entry.date === date.toString())?.available
    ?? schedule.openWeekdays.includes(date.dayOfWeek);
}

// Read directly so calendar edits are visible immediately. Bookings never consume a date.
export async function listPublicViewingAvailability(
  rentalListingId: string,
  now: Temporal.Instant = Temporal.Now.instant()
): Promise<PublicViewingAvailability> {
  const schedule = await getViewingSchedule(rentalListingId);
  const bounds = showingDateBounds(now);
  const end = Temporal.PlainDate.from(bounds.maximum);
  const dates: PublicViewingAvailability["dates"] = [];
  for (let date = Temporal.PlainDate.from(bounds.minimum); Temporal.PlainDate.compare(date, end) < 0; date = date.add({ days: 1 })) {
    if (isViewingDateAvailable(schedule, date)) {
      dates.push({ date: date.toString(), label: formatViewingDate(date.toString()) });
    }
  }
  return { window: { start: bounds.minimum, end: bounds.maximum, timezone: schedule.timezone }, dates };
}

export function formatViewingDate(date: string) {
  return new Intl.DateTimeFormat("en-CA", {
    weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC"
  }).format(new Date(`${date}T12:00:00Z`));
}
