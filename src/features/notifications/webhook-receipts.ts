import { createClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/api";

declare global {
  var __tingtingWebhookReceipts: Set<string> | undefined;
}

export async function recordWebhookReceiptOnce(
  provider: "resend" | "twilio",
  providerEventId: string,
  safeEventType: string
) {
  if (process.env.DATA_BACKEND !== "supabase") {
    globalThis.__tingtingWebhookReceipts ??= new Set();
    const receiptKey = `${provider}:${providerEventId}`;
    if (globalThis.__tingtingWebhookReceipts.has(receiptKey)) return false;
    globalThis.__tingtingWebhookReceipts.add(receiptKey);
    return true;
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new ApiError(503, "WEBHOOK_STORE_UNAVAILABLE", "Webhook storage is unavailable.");
  }
  const client = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data, error } = await client.rpc("record_provider_webhook_once", {
    p_provider: provider,
    p_provider_event_id: providerEventId,
    p_safe_event_type: safeEventType
  });
  if (error) throw new ApiError(503, "WEBHOOK_STORE_UNAVAILABLE", "Webhook storage is unavailable.");
  return Boolean(data);
}
