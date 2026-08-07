import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { Temporal } from "@js-temporal/polyfill";
import type { EmailProvider } from "@/features/notifications/providers/types";
import {
  createNotificationProviders,
  resolveEmailProviderMode
} from "@/features/notifications/providers";
import { getRepository } from "@/data/repository";
import { ApiError } from "@/lib/api";
import { showingRequestInputSchema } from "@/lib/schemas";
import { renderShowingRequestNotification } from "@/features/showings/notification";
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
  desiredMoveInDate: string;
  hasPets: boolean;
  needsParking: boolean;
  notes: string;
  status: "requested";
  consentAt: string;
}

declare global {
  var __tingtingShowingRateLimits: Map<string, DemoRateLimit> | undefined;
  var __tingtingShowingRequests: StoredShowingRequest[] | undefined;
}

function safeClientKey(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded || request.headers.get("x-real-ip") || "unknown";
  const userAgent = request.headers.get("user-agent")?.slice(0, 120) ?? "unknown";
  return createHash("sha256").update(`${address}:${userAgent}`).digest("hex");
}

function consumeDemoLimit(key: string) {
  globalThis.__tingtingShowingRateLimits ??= new Map();
  const now = Date.now();
  const current = globalThis.__tingtingShowingRateLimits.get(key);
  if (!current || now - current.windowStartedAt >= 15 * 60_000) {
    globalThis.__tingtingShowingRateLimits.set(key, { count: 1, windowStartedAt: now });
    return true;
  }
  current.count += 1;
  return current.count <= 5;
}

interface SubmitOptions {
  now?: string;
  recipient?: string | null;
  notifier?: EmailProvider;
}

export async function submitShowingRequest(payload: unknown, request: Request, options: SubmitOptions = {}) {
  const input = showingRequestInputSchema.parse(payload);
  if (input.website) return { accepted: true, status: "requested" as const };

  const property = await getRepository().getPublicRentalBySlug(input.propertySlug);
  if (!property || property.status !== "published" || !property.publishedAt) {
    throw new ApiError(404, "SHOWING_PROPERTY_NOT_FOUND", "This property is no longer available for showing requests.");
  }

  const now = options.now ? new Date(options.now).toISOString() : new Date().toISOString();
  let slot;
  try {
    slot = resolveShowingSlot(input, Temporal.Instant.from(now));
  } catch (error) {
    if (error instanceof ShowingScheduleError) {
      throw new ApiError(400, error.code, error.message);
    }
    throw error;
  }
  const key = safeClientKey(request);
  let requestId: string;
  const createdAt = now;

  if (process.env.DATA_BACKEND === "supabase") {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
      throw new ApiError(503, "SHOWING_SERVICE_UNAVAILABLE", "The showing request service is temporarily unavailable.");
    }
    const client = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data: allowed, error: limitError } = await client.rpc("consume_contact_rate_limit", {
      p_key_hash: key,
      p_limit: 5,
      p_window: "00:15:00"
    });
    if (limitError) {
      throw new ApiError(503, "SHOWING_SERVICE_UNAVAILABLE", "The showing request service is temporarily unavailable.");
    }
    if (!allowed) throw new ApiError(429, "SHOWING_RATE_LIMITED", "Please wait before sending another showing request.");

    const { data: saved, error } = await client
      .from("showing_requests")
      .insert({
        rental_listing_id: property.id,
        property_slug: property.slug,
        property_title: property.title,
        property_address: `${property.addressLine}, ${property.city}`,
        name: input.name,
        phone: input.phone,
        email: input.email,
        desired_move_in_date: input.desiredMoveInDate,
        requested_start_at: slot.requestedStartAt,
        requested_local_date: slot.requestedLocalDate,
        requested_local_time: slot.requestedLocalTime,
        requested_timezone: slot.timezone,
        notes: input.notes,
        has_pets: input.hasPets,
        needs_parking: input.needsParking,
        representation_disclosure_acknowledged_at: createdAt,
        consent_at: createdAt
      })
      .select("id")
      .single();
    if (error || !saved) {
      throw new ApiError(503, "SHOWING_SERVICE_UNAVAILABLE", "The showing request service is temporarily unavailable.");
    }
    requestId = String(saved.id);
  } else {
    if (!consumeDemoLimit(key)) {
      throw new ApiError(429, "SHOWING_RATE_LIMITED", "Please wait before sending another showing request.");
    }
    requestId = crypto.randomUUID();
    globalThis.__tingtingShowingRequests ??= [];
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
      desiredMoveInDate: input.desiredMoveInDate,
      hasPets: input.hasPets,
      needsParking: input.needsParking,
      notes: input.notes,
      status: "requested",
      consentAt: createdAt
    });
  }

  const recipient = options.recipient === undefined ? process.env.CONTACT_TO_EMAIL : options.recipient;
  const mode = resolveEmailProviderMode();
  if (recipient && (options.notifier || mode !== "disabled")) {
    const notifier = options.notifier ?? createNotificationProviders({ email: mode, sms: "disabled" }).email;
    const notification = renderShowingRequestNotification({
      requestId,
      request: input,
      property,
      requestedStartAt: slot.requestedStartAt
    });
    try {
      await notifier.send({
        to: recipient,
        subject: notification.subject,
        text: notification.text,
        html: notification.html,
        idempotencyKey: `showing-request-${requestId}`
      });
    } catch {
      throw new ApiError(
        503,
        "SHOWING_NOTIFICATION_UNAVAILABLE",
        "Your request was saved, but notification delivery is temporarily unavailable. Please call Ting Ting for help."
      );
    }
  }

  return {
    accepted: true,
    requestId,
    status: "requested" as const,
    requestedStartAt: slot.requestedStartAt,
    timezone: slot.timezone,
    message: "Your showing has been requested. Ting Ting will contact you to confirm or arrange another time."
  };
}

export function getDemoShowingRequestsForTests() {
  return structuredClone(globalThis.__tingtingShowingRequests ?? []);
}
