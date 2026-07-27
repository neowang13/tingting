import { createClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/api";

interface RateState {
  count: number;
  startedAt: number;
}

declare global {
  var __tingtingActionRateLimits: Map<string, RateState> | undefined;
}

export async function assertActionRateLimit(
  actorKey: string,
  actionKey: string,
  limit: number,
  windowSeconds: number
) {
  if (process.env.DATA_BACKEND !== "supabase") {
    globalThis.__tingtingActionRateLimits ??= new Map();
    const key = `${actorKey}:${actionKey}`;
    const now = Date.now();
    const state = globalThis.__tingtingActionRateLimits.get(key);
    if (!state || now - state.startedAt >= windowSeconds * 1000) {
      globalThis.__tingtingActionRateLimits.set(key, { count: 1, startedAt: now });
      return;
    }
    state.count += 1;
    if (state.count > limit) {
      throw new ApiError(429, "RATE_LIMITED", "Please wait before trying this action again.");
    }
    return;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new ApiError(503, "RATE_LIMIT_UNAVAILABLE", "Rate limiting is unavailable.");
  const client = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data, error } = await client.rpc("consume_action_rate_limit", {
    p_actor_key: actorKey,
    p_action_key: actionKey,
    p_limit: limit,
    p_window: `00:${Math.floor(windowSeconds / 60).toString().padStart(2, "0")}:${(windowSeconds % 60).toString().padStart(2, "0")}`
  });
  if (error) throw new ApiError(503, "RATE_LIMIT_UNAVAILABLE", "Rate limiting is unavailable.");
  if (!data) throw new ApiError(429, "RATE_LIMITED", "Please wait before trying this action again.");
}
