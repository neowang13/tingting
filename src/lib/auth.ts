import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ApiError } from "@/lib/api";
import {
  LOCAL_ADMIN_SESSION_COOKIE,
  readCookieValue,
  verifyLocalAdminSession
} from "@/lib/local-admin-auth";

export interface AdminIdentity {
  userId: string;
  email: string;
  displayName: string;
  authenticatedAt: string;
  assuranceLevel: "aal1" | "aal2";
}

export function isDemoMode() {
  return process.env.DATA_BACKEND !== "supabase";
}

interface VerifiedClaims {
  aal?: "aal1" | "aal2";
  iat?: number;
}

function readVerifiedClaims(token: string): VerifiedClaims {
  try {
    const encoded = token.split(".")[1];
    if (!encoded) return {};
    return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as VerifiedClaims;
  } catch {
    return {};
  }
}

export async function requireAdminRequest(request: Request): Promise<AdminIdentity> {
  if (isDemoMode()) {
    const admin = verifyLocalAdminSession(readCookieValue(request, LOCAL_ADMIN_SESSION_COOKIE));
    if (!admin) throw new ApiError(401, "UNAUTHORIZED", "Authentication is required.");
    return admin;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!url || !serviceKey || !token) throw new ApiError(401, "UNAUTHORIZED", "Authentication is required.");

  const client = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) throw new ApiError(401, "UNAUTHORIZED", "The session is invalid.");
  const claims = readVerifiedClaims(token);
  if (process.env.NODE_ENV === "production" && claims.aal !== "aal2") {
    throw new ApiError(403, "MFA_REQUIRED", "Multi-factor authentication is required.");
  }

  const { data: profile } = await client
    .from("admin_profiles")
    .select("display_name,is_active")
    .eq("user_id", data.user.id)
    .maybeSingle();

  if (!profile?.is_active) throw new ApiError(403, "FORBIDDEN", "This administrator account is inactive.");
  return {
    userId: data.user.id,
    email: data.user.email ?? "",
    displayName: profile.display_name,
    authenticatedAt: new Date((claims.iat ?? 0) * 1000).toISOString(),
    assuranceLevel: claims.aal ?? "aal1"
  };
}

export async function requireAdminPage(): Promise<AdminIdentity> {
  if (isDemoMode()) {
    const cookieStore = await cookies();
    const admin = verifyLocalAdminSession(cookieStore.get(LOCAL_ADMIN_SESSION_COOKIE)?.value);
    if (!admin) redirect("/admin/login");
    return admin;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) redirect("/admin/login");

  const cookieStore = await cookies();
  const client = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (items) => {
        try {
          items.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components can read but cannot always write response cookies.
        }
      }
    }
  });
  const { data } = await client.auth.getUser();
  if (!data.user) redirect("/admin/login");
  const { data: sessionData } = await client.auth.getSession();
  const token = sessionData.session?.access_token;
  const claims = token ? readVerifiedClaims(token) : {};
  if (process.env.NODE_ENV === "production" && claims.aal !== "aal2") {
    redirect("/admin/login?error=mfa_required");
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) redirect("/admin/login?error=configuration");
  const serviceClient = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: profile } = await serviceClient
    .from("admin_profiles")
    .select("display_name,is_active")
    .eq("user_id", data.user.id)
    .maybeSingle();
  if (!profile?.is_active) redirect("/admin/login?error=inactive");

  return {
    userId: data.user.id,
    email: data.user.email ?? "",
    displayName: profile.display_name,
    authenticatedAt: new Date((claims.iat ?? 0) * 1000).toISOString(),
    assuranceLevel: claims.aal ?? "aal1"
  };
}

export function assertRecentAuthentication(admin: AdminIdentity, maximumAgeMinutes = 10) {
  if (Date.now() - Date.parse(admin.authenticatedAt) > maximumAgeMinutes * 60_000) {
    throw new ApiError(
      403,
      "RECENT_AUTHENTICATION_REQUIRED",
      "Please sign in again before completing this sensitive action."
    );
  }
}

export function assertRecentAal2(admin: AdminIdentity, maximumAgeMinutes = 10) {
  if (admin.assuranceLevel !== "aal2") {
    throw new ApiError(403, "MFA_REQUIRED", "Multi-factor authentication is required for this action.");
  }
  assertRecentAuthentication(admin, maximumAgeMinutes);
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") {
    throw new ApiError(403, "CROSS_SITE_REQUEST_BLOCKED", "Cross-site requests are not allowed.");
  }
  const allowedOrigins = new Set([new URL(request.url).origin]);
  if (process.env.APP_BASE_URL) {
    try {
      allowedOrigins.add(new URL(process.env.APP_BASE_URL).origin);
    } catch {
      // Environment validation reports malformed APP_BASE_URL separately.
    }
  }
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedHost) {
    const forwardedProto = request.headers.get("x-forwarded-proto") ?? "https";
    allowedOrigins.add(`${forwardedProto}://${forwardedHost}`);
  }
  if (origin && !allowedOrigins.has(origin)) {
    throw new ApiError(403, "ORIGIN_MISMATCH", "The request origin is not allowed.");
  }
}
