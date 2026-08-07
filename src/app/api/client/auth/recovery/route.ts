import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { z } from "zod";
import { ApiError, handleApiError, ok, readJson } from "@/lib/api";
import { assertSameOrigin } from "@/lib/auth";
import { CLIENT_SUPABASE_COOKIE_NAME } from "@/lib/client-auth-config";
import {
  CLIENT_RECOVERY_COOKIE_NAME,
  expireClientRecoveryMarker,
  expireClientRecoverySession,
  isEligibleRecoveryClient,
  verifyClientRecoveryMarker
} from "@/lib/client-recovery";

export const dynamic = "force-dynamic";

const passwordSchema = z.object({
  password: z.string().min(11).max(256)
}).strict();

async function authorizeRecovery(request: Request, cookieStore: Awaited<ReturnType<typeof cookies>>) {
  const secure = new URL(request.url).protocol === "https:";
  const marker = verifyClientRecoveryMarker(cookieStore.get(CLIENT_RECOVERY_COOKIE_NAME)?.value);
  if (!marker) {
    expireClientRecoveryMarker(cookieStore, secure);
    throw new ApiError(401, "RECOVERY_INTENT_REQUIRED", "This password recovery link is invalid or expired.");
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) {
    throw new ApiError(503, "CLIENT_AUTH_CONFIGURATION_ERROR", "Client authentication is not configured.");
  }

  const authClient = createServerClient(url, anonKey, {
    cookieOptions: { name: CLIENT_SUPABASE_COOKIE_NAME },
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (items) => items.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
    }
  });
  const { data, error } = await authClient.auth.getUser();
  if (error || !data.user || data.user.id !== marker.sub || !data.user.email_confirmed_at) {
    expireClientRecoverySession(cookieStore, secure);
    throw new ApiError(401, "RECOVERY_SESSION_INVALID", "This password recovery link is invalid or expired.");
  }
  const service = createClient(url, serviceKey, { auth: { persistSession: false } });
  if (!await isEligibleRecoveryClient(service, data.user.id)) {
    await authClient.auth.signOut({ scope: "local" }).catch(() => undefined);
    expireClientRecoverySession(cookieStore, secure);
    throw new ApiError(403, "RECOVERY_IDENTITY_DENIED", "This account cannot use Client password recovery.");
  }
  return { authClient, secure };
}

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    await authorizeRecovery(request, await cookies());
    return ok({ ready: true }, requestId);
  } catch (error) {
    return handleApiError(error, requestId);
  }
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const cookieStore = await cookies();
  try {
    assertSameOrigin(request);
    const input = passwordSchema.parse(await readJson(request));
    const { authClient, secure } = await authorizeRecovery(request, cookieStore);
    const updated = await authClient.auth.updateUser({ password: input.password });
    if (updated.error) {
      await authClient.auth.signOut({ scope: "local" }).catch(() => undefined);
      expireClientRecoverySession(cookieStore, secure);
      throw new ApiError(400, "PASSWORD_UPDATE_FAILED", "The password could not be updated. Request a new recovery link.");
    }
    const signedOut = await authClient.auth.signOut({ scope: "local" });
    expireClientRecoverySession(cookieStore, secure);
    if (signedOut.error) {
      throw new ApiError(500, "RECOVERY_SESSION_CLEAR_FAILED", "The recovery session could not be cleared.");
    }
    return ok({ updated: true }, requestId);
  } catch (error) {
    return handleApiError(error, requestId);
  }
}
