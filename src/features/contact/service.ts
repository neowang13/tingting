import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import {
  createNotificationProviders,
  resolveEmailProviderMode
} from "@/features/notifications/providers";
import { ApiError } from "@/lib/api";
import { contactInputSchema } from "@/lib/schemas";

interface DemoRateLimit {
  count: number;
  windowStartedAt: number;
}

declare global {
  var __tingtingContactRateLimits: Map<string, DemoRateLimit> | undefined;
  var __tingtingContactEnquiries:
    | Array<{ id: string; createdAt: string; payload: ReturnType<typeof contactInputSchema.parse> }>
    | undefined;
}

function safeClientKey(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded || request.headers.get("x-real-ip") || "unknown";
  const userAgent = request.headers.get("user-agent")?.slice(0, 120) ?? "unknown";
  return createHash("sha256").update(`${address}:${userAgent}`).digest("hex");
}

function consumeDemoLimit(key: string) {
  globalThis.__tingtingContactRateLimits ??= new Map();
  const now = Date.now();
  const current = globalThis.__tingtingContactRateLimits.get(key);
  if (!current || now - current.windowStartedAt >= 15 * 60_000) {
    globalThis.__tingtingContactRateLimits.set(key, { count: 1, windowStartedAt: now });
    return true;
  }
  current.count += 1;
  return current.count <= 5;
}

export async function submitContactEnquiry(payload: unknown, request: Request) {
  const input = contactInputSchema.parse(payload);
  if (input.website) return { accepted: true };

  const key = safeClientKey(request);
  if (process.env.DATA_BACKEND === "supabase") {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
      throw new ApiError(503, "CONTACT_SERVICE_UNAVAILABLE", "The contact service is temporarily unavailable.");
    }
    const client = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data: allowed, error: limitError } = await client.rpc("consume_contact_rate_limit", {
      p_key_hash: key,
      p_limit: 5,
      p_window: "00:15:00"
    });
    if (limitError) {
      throw new ApiError(503, "CONTACT_SERVICE_UNAVAILABLE", "The contact service is temporarily unavailable.");
    }
    if (!allowed) throw new ApiError(429, "CONTACT_RATE_LIMITED", "Please wait before sending another message.");

    const { data: enquiry, error } = await client
      .from("contact_enquiries")
      .insert({
        name: input.name,
        email: input.email ?? null,
        phone: input.phone ?? null,
        preferred_contact: input.preferredContact,
        message: input.message
      })
      .select("id")
      .single();
    if (error || !enquiry) {
      throw new ApiError(503, "CONTACT_SERVICE_UNAVAILABLE", "The contact service is temporarily unavailable.");
    }

    const recipient = process.env.CONTACT_TO_EMAIL;
    const mode = resolveEmailProviderMode();
    if (recipient && mode !== "disabled") {
      const provider = createNotificationProviders({ email: mode, sms: "disabled" }).email;
      const text = [
        `Name: ${input.name}`,
        `Preferred contact: ${input.preferredContact}`,
        `Email: ${input.email ?? "Not provided"}`,
        `Phone: ${input.phone ?? "Not provided"}`,
        "",
        input.message
      ].join("\n");
      try {
        await provider.send({
          to: recipient,
          subject: "New website enquiry",
          text,
          html: escapeHtml(text).replaceAll("\n", "<br>"),
          idempotencyKey: `contact-${enquiry.id}`
        });
      } catch {
        throw new ApiError(
          503,
          "CONTACT_SERVICE_UNAVAILABLE",
          "Your message was saved, but notification delivery is temporarily unavailable."
        );
      }
    }
  } else {
    if (!consumeDemoLimit(key)) {
      throw new ApiError(429, "CONTACT_RATE_LIMITED", "Please wait before sending another message.");
    }
    globalThis.__tingtingContactEnquiries ??= [];
    globalThis.__tingtingContactEnquiries.push({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      payload: input
    });
  }

  return { accepted: true };
}

export function getDemoContactEnquiriesForTests() {
  return structuredClone(globalThis.__tingtingContactEnquiries ?? []);
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
