import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";
import { ApiError } from "@/lib/api";
import { getRepository } from "@/data/repository";
import { mcpServiceClient } from "@/features/mcp/auth";
import { getViewingSchedule } from "./availability";
import { resolveShowingSlot, SHOWING_TIMEZONE } from "./scheduling";
import type { StoredShowingRequest } from "./service";

export const showingStatusSchema = z.enum(["requested", "accepted", "declined", "reschedule_requested", "cancelled"]);
export const manageShowingSchema = z.object({
  id: z.uuid(), expectedUpdatedAt: z.string().min(1).max(64),
  action: z.enum(["accept", "decline", "cancel", "reschedule"]),
  date: z.iso.date().optional(), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  reason: z.string().trim().min(1).max(500)
}).strict().superRefine((input, ctx) => {
  if (input.action === "reschedule" && !input.date) ctx.addIssue({ code: "custom", path: ["date"], message: "Rescheduling requires a date." });
  if (["decline", "cancel"].includes(input.action) && (input.date || input.time)) ctx.addIssue({ code: "custom", path: ["date"], message: "Cancellation/decline does not accept a date or time." });
});
export type ManagedShowing = StoredShowingRequest & { updatedAt: string };
export async function listManagedShowings(input: { id?: string; propertyId?: string; status?: z.infer<typeof showingStatusSchema>; from?: string; to?: string; offset: number; limit: number }) {
  if (process.env.DATA_BACKEND !== "supabase") {
    return (globalThis.__tingtingShowingRequests ?? []).filter(row =>
      (!input.id || row.id === input.id) && (!input.propertyId || row.propertyId === input.propertyId) && (!input.status || row.status === input.status)
      && (!input.from || row.requestedLocalDate >= input.from) && (!input.to || row.requestedLocalDate <= input.to))
      .sort((a,b) => a.requestedLocalDate.localeCompare(b.requestedLocalDate) || a.id.localeCompare(b.id))
      .slice(input.offset, input.offset + input.limit).map(row => ({ ...row, updatedAt: row.updatedAt ?? row.createdAt }));
  }
  let query = mcpServiceClient().from("showing_requests").select("id,created_at,updated_at,rental_listing_id,property_slug,property_title,property_address,requested_start_at,requested_local_date,requested_local_time,requested_timezone,name,phone,email,notes,status,accepted_at")
    .order("requested_local_date").order("id").range(input.offset, input.offset + input.limit - 1);
  if (input.propertyId) query = query.eq("rental_listing_id", input.propertyId);
  if (input.id) query = query.eq("id", input.id);
  if (input.status) query = query.eq("status", input.status);
  if (input.from) query = query.gte("requested_local_date", input.from);
  if (input.to) query = query.lte("requested_local_date", input.to);
  const { data, error } = await query;
  if (error) throw new ApiError(503, "SHOWING_SERVICE_UNAVAILABLE", "Viewing requests could not be loaded.");
  return (data ?? []).map(row => ({ id: row.id, createdAt: row.created_at, updatedAt: row.updated_at,
    propertyId: row.rental_listing_id, propertySlug: row.property_slug, propertyTitle: row.property_title,
    propertyAddress: row.property_address, requestedStartAt: row.requested_start_at, requestedLocalDate: row.requested_local_date,
    requestedLocalTime: row.requested_local_time, timezone: row.requested_timezone, name: row.name, phone: row.phone,
    email: row.email, notes: row.notes, status: row.status, acceptedAt: row.accepted_at })) as ManagedShowing[];
}
export async function manageShowing(input: z.infer<typeof manageShowingSchema>, actorId: string) {
  if (process.env.DATA_BACKEND === "supabase") {
    const { data, error } = await mcpServiceClient().rpc("mcp_manage_showing", {
      p_id: input.id, p_expected_updated_at: input.expectedUpdatedAt, p_action: input.action,
      p_date: input.date ?? null, p_time: input.time ?? null, p_reason: input.reason, p_actor_id: actorId
    });
    if (error?.code === "TT409") throw new ApiError(409, "SHOWING_CHANGED", "The request changed, is closed, or the date is unavailable. Reload before continuing.");
    if (error || !data) throw new ApiError(503, "SHOWING_SERVICE_UNAVAILABLE", "The request could not be updated.");
    return data as Record<string, unknown>;
  }
  const row = globalThis.__tingtingShowingRequests?.find(row => row.id === input.id);
  if (!row) throw new ApiError(404, "SHOWING_NOT_FOUND", "Viewing request not found.");
  const version = row.updatedAt ?? row.createdAt;
  if (version !== input.expectedUpdatedAt || ["cancelled", "declined"].includes(row.status)) throw new ApiError(409, "SHOWING_CHANGED", "The request changed or is closed. Reload before continuing.");
  const date = input.date ?? row.requestedLocalDate;
  let start: string | null = null;
  if (["accept", "reschedule"].includes(input.action)) {
    const rental = await getRepository().getRental(row.propertyId);
    if (rental.status !== "published") throw new ApiError(409, "SHOWING_PROPERTY_UNAVAILABLE", "The property is not published.");
    resolveShowingSlot({ requestedLocalDate: date, timezone: SHOWING_TIMEZONE }, Temporal.Now.instant(), await getViewingSchedule(row.propertyId));
    if (input.time) {
      start = Temporal.PlainDate.from(date).toPlainDateTime(input.time).toZonedDateTime(SHOWING_TIMEZONE, { disambiguation: "reject" }).toInstant().toString();
      if (Date.parse(start) <= Date.now()) throw new ApiError(409, "SHOWING_TIME_PAST", "Choose a future time.");
    }
  }
  // Recheck after awaits: another tool invocation can have changed this row.
  if ((row.updatedAt ?? row.createdAt) !== version) throw new ApiError(409, "SHOWING_CHANGED", "The request changed. Reload before continuing.");
  const now = new Date(Math.max(Date.now(), Date.parse(version) + 1)).toISOString();
  row.status = input.action === "cancel" ? "cancelled" : input.action === "decline" ? "declined" : "accepted";
  row.acceptedAt = row.status === "accepted" ? now : null;
  row.updatedAt = now;
  if (row.status === "accepted") Object.assign(row, { requestedLocalDate: date, requestedLocalTime: input.time ?? null, requestedStartAt: start });
  return { id: row.id, status: row.status, date: row.requestedLocalDate, time: row.requestedLocalTime,
    timezone: row.timezone, updatedAt: row.updatedAt, notification: "not_sent" };
}
