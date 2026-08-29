import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { Temporal } from "@js-temporal/polyfill";
import type { EmailProvider } from "@/features/notifications/providers/types";
import { getRepository } from "@/data/repository";
import { deliverOwnerNotifications } from "@/features/notifications/owner-notifications";
import { ApiError } from "@/lib/api";
import { showingRequestInputSchema } from "@/lib/schemas";
import { renderShowingRequestNotification } from "@/features/showings/notification";
import {
  getViewingSchedule,
  invalidateViewingAvailabilityCache
} from "@/features/showings/availability";
import {
  resolveShowingSlot,
  ShowingScheduleError
} from "@/features/showings/scheduling";

interface DemoRateLimit {
  count: number;
  windowStartedAt: number;
}

export interface StoredShowingRequest {
  id: string;
  createdAt: string;
  propertyId: string;
  propertySlug: string;
  propertyTitle: string;
  propertyAddress: string;
  requestedStartAt: string;
  requestedLocalDate: string;
  requestedLocalTime: string;
  timezone: string;
  name: string;
  phone: string;
  email: string;
  notes: string;
  status: "accepted";
  acceptedAt: string;
}

declare global {
  var __tingtingShowingRateLimits: Map<string, DemoRateLimit> | undefined;
  var __tingtingShowingRequests: StoredShowingRequest[] | undefined;
}

function hashLimitKey(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function showingRateLimits(request: Request, email: string, phone: string) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  // Render guarantees the first X-Forwarded-For entry is the real client IP.
  // Do not trust X-Real-IP in production because a public client can supply it.
  const address = forwarded || (process.env.DATA_BACKEND !== "supabase"
    ? request.headers.get("x-real-ip")
    : null) || "unknown";
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedPhone = phone.replace(/\D/g, "");
  return [
    { key: hashLimitKey(`showing:ip:${address}`), limit: 5 },
    { key: hashLimitKey(`showing:email:${normalizedEmail}`), limit: 3 },
    { key: hashLimitKey(`showing:phone:${normalizedPhone}`), limit: 3 }
  ];
}

function consumeDemoLimit(key: string, limit: number) {
  globalThis.__tingtingShowingRateLimits ??= new Map();
  const now = Date.now();
  const current = globalThis.__tingtingShowingRateLimits.get(key);
  if (!current || now - current.windowStartedAt >= 15 * 60_000) {
    globalThis.__tingtingShowingRateLimits.set(key, { count: 1, windowStartedAt: now });
    return true;
  }
  current.count += 1;
  return current.count <= limit;
}

function showingServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new ApiError(503, "SHOWING_SERVICE_UNAVAILABLE", "The showing request service is temporarily unavailable.");
  }
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

async function consumeShowingRateLimits(limits: Array<{ key: string; limit: number }>) {
  if (process.env.DATA_BACKEND !== "supabase") {
    if (limits.some((limit) => !consumeDemoLimit(limit.key, limit.limit))) {
      throw new ApiError(429, "SHOWING_RATE_LIMITED", "Please wait before booking another viewing.");
    }
    return;
  }

  const client = showingServiceClient();
  for (const limit of limits) {
    const { data: allowed, error } = await client.rpc("consume_contact_rate_limit", {
      p_key_hash: limit.key,
      p_limit: limit.limit,
      p_window: "00:15:00"
    });
    if (error) {
      throw new ApiError(503, "SHOWING_SERVICE_UNAVAILABLE", "The showing request service is temporarily unavailable.");
    }
    if (!allowed) throw new ApiError(429, "SHOWING_RATE_LIMITED", "Please wait before booking another viewing.");
  }
}

interface SubmitOptions {
  now?: string;
  recipient?: string | null;
  notifier?: EmailProvider;
}

export async function submitShowingRequest(payload: unknown, request: Request, options: SubmitOptions = {}) {
  const input = showingRequestInputSchema.parse(payload);
  if (input.website) return { accepted: true, status: "accepted" as const };
  const limits = showingRateLimits(request, input.email, input.phone);
  await consumeShowingRateLimits(limits);

  const property = await getRepository().getPublicRentalBySlug(input.propertySlug);
  if (!property || property.status !== "published" || !property.publishedAt) {
    throw new ApiError(404, "SHOWING_PROPERTY_NOT_FOUND", "This property is no longer available for showing requests.");
  }

  const now = options.now ? new Date(options.now).toISOString() : new Date().toISOString();
  const schedule = await getViewingSchedule();
  let slot;
  try {
    slot = resolveShowingSlot(input, Temporal.Instant.from(now), schedule);
  } catch (error) {
    if (error instanceof ShowingScheduleError) {
      throw new ApiError(400, error.code, error.message);
    }
    throw error;
  }
  const requestId = crypto.randomUUID();
  const createdAt = now;
  const recipient = options.recipient === undefined ? process.env.CONTACT_TO_EMAIL : options.recipient;
  const notification = recipient ? renderShowingRequestNotification({
    requestId,
    request: input,
    property,
    requestedStartAt: slot.requestedStartAt,
    appBaseUrl: process.env.APP_BASE_URL
  }) : null;

  if (process.env.DATA_BACKEND === "supabase") {
    const client = showingServiceClient();

    const { data: saved, error } = await client.rpc("reserve_viewing_appointment", {
      p_request_id: requestId,
      p_rental_listing_id: property.id,
      p_property_slug: property.slug,
      p_property_title: property.title,
      p_property_address: `${property.addressLine}, ${property.city}`,
      p_name: input.name,
      p_phone: input.phone,
      p_email: input.email,
      p_requested_start_at: slot.requestedStartAt,
      p_requested_local_date: slot.requestedLocalDate,
      p_requested_local_time: slot.requestedLocalTime,
      p_notes: input.notes,
      p_created_at: createdAt,
      p_notification_payload: notification && !options.notifier ? {
        subject: notification.subject,
        text: notification.text,
        html: notification.html
      } : null
    });
    if (error?.code === "23505") {
      throw new ApiError(409, "SHOWING_SLOT_TAKEN", "That viewing time was just booked. Choose another available time.");
    }
    if (error || !saved) {
      throw new ApiError(503, "SHOWING_SERVICE_UNAVAILABLE", "The showing request service is temporarily unavailable.");
    }
  } else {
    globalThis.__tingtingShowingRequests ??= [];
    if (globalThis.__tingtingShowingRequests.some((item) =>
      item.status === "accepted" && item.requestedStartAt === slot.requestedStartAt
    )) {
      throw new ApiError(409, "SHOWING_SLOT_TAKEN", "That viewing time was just booked. Choose another available time.");
    }
    globalThis.__tingtingShowingRequests.push({
      id: requestId,
      createdAt,
      propertyId: property.id,
      propertySlug: property.slug,
      propertyTitle: property.title,
      propertyAddress: `${property.addressLine}, ${property.city}`,
      requestedStartAt: slot.requestedStartAt,
      requestedLocalDate: slot.requestedLocalDate,
      requestedLocalTime: slot.requestedLocalTime,
      timezone: slot.timezone,
      name: input.name,
      phone: input.phone,
      email: input.email,
      notes: input.notes,
      status: "accepted",
      acceptedAt: createdAt
    });
  }
  invalidateViewingAvailabilityCache();

  if (recipient && notification) {
    if (options.notifier) {
      await options.notifier.send({
        to: recipient,
        subject: notification.subject,
        text: notification.text,
        html: notification.html,
        idempotencyKey: `showing-request-${requestId}`
      });
    } else if (process.env.DATA_BACKEND !== "supabase") {
      await getRepository().enqueueOwnerNotification({
        notificationKey: `showing-confirmation:${requestId}`,
        kind: "showing_confirmation",
        tenantId: null,
        payload: {
          subject: notification.subject,
          text: notification.text,
          html: notification.html
        },
        scheduledFor: createdAt
      });
    }
    if (!options.notifier) await deliverOwnerNotifications({ limit: 1 }).catch(() => undefined);
  }

  return {
    accepted: true,
    requestId,
    status: "accepted" as const,
    requestedStartAt: slot.requestedStartAt,
    timezone: slot.timezone,
    message: "Your viewing is confirmed. Ting Ting will contact you if the appointment needs to change."
  };
}

export function getDemoShowingRequestsForTests() {
  return structuredClone(globalThis.__tingtingShowingRequests ?? []);
}
