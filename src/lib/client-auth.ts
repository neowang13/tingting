import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ApiError } from "@/lib/api";
import type { ClientIdentity } from "@/features/applications/contracts";
import { isDemoMode } from "@/lib/auth";
import { LOCAL_CLIENT_SESSION_COOKIE, verifyLocalClientSession } from "@/lib/local-client-auth";
import { readCookieValue } from "@/lib/local-admin-auth";

async function resolveSupabaseClient(): Promise<ClientIdentity> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) {
    throw new ApiError(503, "CLIENT_AUTH_CONFIGURATION_ERROR", "Client authentication is not configured.");
  }
  const cookieStore = await cookies();
  const authClient = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (items) => items.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
    }
  });
  const { data, error } = await authClient.auth.getUser();
  if (error || !data.user) throw new ApiError(401, "UNAUTHORIZED", "Client authentication is required.");
  const service = createClient(url, serviceKey, { auth: { persistSession: false } });
  const profile = await service.from("client_profiles")
    .select("display_name,is_active")
    .eq("user_id", data.user.id)
    .maybeSingle();
  if (profile.error || !profile.data?.is_active) {
    throw new ApiError(403, "CLIENT_ACCESS_DENIED", "This account does not have access to Client Login.");
  }
  return { userId: data.user.id, email: data.user.email ?? "", displayName: profile.data.display_name };
}

export async function requireClientRequest(request: Request): Promise<ClientIdentity> {
  if (isDemoMode()) {
    const identity = verifyLocalClientSession(readCookieValue(request, LOCAL_CLIENT_SESSION_COOKIE));
    if (!identity) throw new ApiError(401, "UNAUTHORIZED", "Client authentication is required.");
    return identity;
  }
  return resolveSupabaseClient();
}

export async function requireClientPage(): Promise<ClientIdentity> {
  try {
    if (isDemoMode()) {
      const cookieStore = await cookies();
      const identity = verifyLocalClientSession(cookieStore.get(LOCAL_CLIENT_SESSION_COOKIE)?.value);
      if (!identity) redirect("/client/login");
      return identity;
    }
    return await resolveSupabaseClient();
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect("/client/login");
  }
}

export async function establishClientSession(tokens: { accessToken: string; refreshToken: string }) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new ApiError(503, "CLIENT_AUTH_CONFIGURATION_ERROR", "Client authentication is not configured.");
  const cookieStore = await cookies();
  const client = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (items) => items.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
    }
  });
  const result = await client.auth.setSession({ access_token: tokens.accessToken, refresh_token: tokens.refreshToken });
  if (result.error || !result.data.user) throw new ApiError(401, "UNAUTHORIZED", "The client session is invalid.");
  return resolveSupabaseClient();
}
