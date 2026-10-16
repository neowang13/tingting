import { ApiError } from "@/lib/api";
import type { RentalListing } from "@/lib/contracts";
import { SHOWING_TIMEZONE } from "@/features/showings/scheduling";
import { viewingScheduleClient, viewingScheduleInputSchema, type ViewingSchedule, type ViewingScheduleInput } from "@/features/showings/availability";

export interface ViewingScheduleDraft extends ViewingSchedule {
  publishedUpdatedAt: string | null;
}
export interface PropertyPublicationResult {
  rental: RentalListing;
  viewingSchedule: ViewingScheduleDraft;
}

declare global {
  var __tingtingViewingDrafts: Map<string, ViewingScheduleDraft> | undefined;
}

export function emptyViewingDraft(id: string): ViewingScheduleDraft {
  return { rentalListingId: id, timezone: SHOWING_TIMEZONE, openWeekdays: [], dateOverrides: [], updatedAt: null, publishedUpdatedAt: null };
}

export function mapViewingDraft(row: Record<string, unknown>): ViewingScheduleDraft {
  return {
    ...viewingScheduleInputSchema.parse(row.draft_schedule ?? {
      timezone: row.timezone, openWeekdays: row.open_weekdays, dateOverrides: row.date_overrides
    }),
    rentalListingId: String(row.rental_listing_id),
    updatedAt: row.draft_updated_at ? String(row.draft_updated_at) : null,
    publishedUpdatedAt: row.updated_at ? String(row.updated_at) : null
  };
}

export async function getViewingScheduleDraft(id: string): Promise<ViewingScheduleDraft> {
  if (process.env.DATA_BACKEND !== "supabase") {
    const live = globalThis.__tingtingPropertyViewingSchedules?.get(id);
    const draft = globalThis.__tingtingViewingDrafts?.get(id);
    return structuredClone({ ...(draft ?? (live ? { ...live, updatedAt: null } : emptyViewingDraft(id))), publishedUpdatedAt: live?.updatedAt ?? null });
  }
  const { data, error } = await viewingScheduleClient().from("property_viewing_schedules").select("*").eq("rental_listing_id", id).maybeSingle();
  if (error) throw new ApiError(503, "VIEWING_DRAFT_UNAVAILABLE", "Viewing dates could not be loaded.");
  return data ? mapViewingDraft(data) : emptyViewingDraft(id);
}

function staleDraft(): never {
  throw new ApiError(409, "VIEWING_DRAFT_CONFLICT", "This property's viewing dates changed. Reload before saving or publishing.");
}
function nextVersion(previous: string | null) {
  return new Date(Math.max(Date.now(), previous ? Date.parse(previous) + 1 : 0)).toISOString();
}

export async function saveViewingScheduleDraft(
  id: string, input: ViewingScheduleInput, expectedUpdatedAt: string | null,
  expectedPublishedUpdatedAt: string | null, actorId: string
): Promise<ViewingScheduleDraft> {
  const schedule = viewingScheduleInputSchema.parse(input);
  if (process.env.DATA_BACKEND !== "supabase") {
    globalThis.__tingtingPropertyViewingSchedules ??= new Map();
    globalThis.__tingtingViewingDrafts ??= new Map();
    let live = globalThis.__tingtingPropertyViewingSchedules.get(id);
    const previous = globalThis.__tingtingViewingDrafts.get(id);
    if ((live?.updatedAt ?? null) !== expectedPublishedUpdatedAt || (previous?.updatedAt ?? null) !== expectedUpdatedAt) staleDraft();
    if (!live) {
      live = { rentalListingId: id, timezone: SHOWING_TIMEZONE, openWeekdays: [], dateOverrides: [], updatedAt: nextVersion(null) };
      globalThis.__tingtingPropertyViewingSchedules.set(id, live);
    }
    const draft = { ...schedule, rentalListingId: id, updatedAt: nextVersion(previous?.updatedAt ?? null), publishedUpdatedAt: live.updatedAt };
    globalThis.__tingtingViewingDrafts.set(id, draft);
    return structuredClone(draft);
  }
  const { data, error } = await viewingScheduleClient().rpc("save_property_viewing_draft", {
    p_id: id, p_schedule: schedule, p_expected_draft_updated_at: expectedUpdatedAt,
    p_expected_published_updated_at: expectedPublishedUpdatedAt, p_actor_id: actorId
  });
  if (error?.code === "TT409") staleDraft();
  if (error || !data) throw new ApiError(503, "VIEWING_DRAFT_UNAVAILABLE", "Viewing dates could not be saved privately.");
  return mapViewingDraft(data as Record<string, unknown>);
}

// Memory publication performs both mutations synchronously after validating both
// versions. If rental publication fails, the returned commit is never called.
export function prepareMemoryViewingPublication(id: string, draftVersion: string, publishedVersion: string | null) {
  const draft = globalThis.__tingtingViewingDrafts?.get(id);
  const live = globalThis.__tingtingPropertyViewingSchedules?.get(id);
  if (!draft || draft.updatedAt !== draftVersion || (live?.updatedAt ?? null) !== publishedVersion) staleDraft();
  const schedule = viewingScheduleInputSchema.parse({ timezone: draft.timezone, openWeekdays: draft.openWeekdays, dateOverrides: draft.dateOverrides });
  return () => {
    const updatedAt = nextVersion(live?.updatedAt ?? null);
    globalThis.__tingtingPropertyViewingSchedules!.set(id, { ...schedule, rentalListingId: id, updatedAt });
    const published = { ...draft, publishedUpdatedAt: updatedAt };
    globalThis.__tingtingViewingDrafts!.set(id, published);
    return structuredClone(published);
  };
}
