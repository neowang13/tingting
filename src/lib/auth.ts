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
import { assertActionRateLimit } from "@/lib/rate-limit";
import { securityFingerprint, writeSecurityAudit } from "@/lib/security-audit";

const ADMIN_IDLE_TIMEOUT_MS = 30 * 60_000;
const ADMIN_ABSOLUTE_TIMEOUT_MS = 12 * 60 * 60_000;
const ADMIN_LAST_ACTIVE_COOKIE = "tt-last-active";
const ADMIN_SESSION_STARTED_COOKIE = "tt-session-started";

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
  exp?: number;
  amr?: Array<{ method?: string; timestamp?: number }>;
}

interface SupabaseSessionTokens {
  accessToken: string;
  refreshToken: string;
}

function isProductionAdminMode() {
  return process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_APP_MODE === "production";
}

function isAdminMfaRequired() {
  if (process.env.NODE_ENV === "production") return true;
  return process.env.NEXT_PUBLIC_APP_MODE === "production" &&
    process.env.NEXT_PUBLIC_ADMIN_MFA_REQUIRED !== "false";
}

function latestAuthenticationTimestamp(claims: VerifiedClaims) {
  const methodTimestamps = (claims.amr ?? [])
    .map((method) => method.timestamp)
    .filter((timestamp): timestamp is number => Number.isFinite(timestamp));
  return Math.max(claims.iat ?? 0, ...methodTimestamps);
}

function assertValidClaims(claims: VerifiedClaims) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!claims.iat || (claims.exp && claims.exp <= nowSeconds)) {
    throw new ApiError(401, "UNAUTHORIZED", "The session is invalid or expired.");
  }
  if (isAdminMfaRequired() && claims.aal !== "aal2") {
    throw new ApiError(403, "MFA_REQUIRED", "Multi-factor authentication is required.");
  }
}

async function resolveSupabaseAdminIdentity(
  url: string,
  serviceKey: string,
  user: { id: string; email?: string },
  claims: VerifiedClaims
): Promise<AdminIdentity> {
  assertValidClaims(claims);

  const serviceClient = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: verifiedProfile } = await serviceClient
    .from("admin_profiles")
    .select("display_name,is_active")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!verifiedProfile?.is_active) {
    await writeRateLimitedAuthAudit(user.id, {
      actorUserId: user.id,
      action: "auth.inactive_admin_denied",
      targetType: "admin_profile",
      targetId: user.id
    });
    throw new ApiError(403, "FORBIDDEN", "This administrator account is inactive.");
  }

  return {
    userId: user.id,
    email: user.email ?? "",
    displayName: verifiedProfile.display_name,
    authenticatedAt: new Date(latestAuthenticationTimestamp(claims) * 1000).toISOString(),
    assuranceLevel: claims.aal ?? "aal1"
  };
}

async function writeRateLimitedAuthAudit(
  actorKey: string,
  input: Parameters<typeof writeSecurityAudit>[0]
) {
  try {
    await assertActionRateLimit(actorKey, `security-audit:${input.action}`, 3, 15 * 60);
    await writeSecurityAudit(input);
  } catch {
    // Authentication decisions do not depend on the availability of the audit sink.
  }
}

function parseSessionTimestamp(value: string | undefined) {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : Number.NaN;
}

async function assertCookieSessionLifetime(request: Request, allowUntrackedSession = false) {
  if (!isProductionAdminMode()) return;
  const lastActive = parseSessionTimestamp(readCookieValue(request, ADMIN_LAST_ACTIVE_COOKIE));
  const sessionStarted = parseSessionTimestamp(readCookieValue(request, ADMIN_SESSION_STARTED_COOKIE));
  if (allowUntrackedSession && lastActive === null && sessionStarted === null) return;

  const now = Date.now();
  if (
    lastActive === null ||
    sessionStarted === null ||
    !Number.isFinite(lastActive) ||
    !Number.isFinite(sessionStarted) ||
    now - lastActive > ADMIN_IDLE_TIMEOUT_MS ||
    now - sessionStarted > ADMIN_ABSOLUTE_TIMEOUT_MS ||
    lastActive > now + 60_000 ||
    sessionStarted > now + 60_000
  ) {
    const source = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "unknown";
    try {
      await assertActionRateLimit(
        securityFingerprint(source),
        "security-audit:session-expired",
        3,
        15 * 60
      );
      await writeSecurityAudit({
        action: "auth.session_expired",
        targetType: "auth_session",
        metadata: {
          reason:
            lastActive === null || sessionStarted === null
              ? "tracking_missing"
              : now - lastActive > ADMIN_IDLE_TIMEOUT_MS
                ? "idle_timeout"
                : "absolute_timeout"
        }
      });
    } catch {
      // Authentication remains fail-closed if audit storage is unavailable or rate limited.
    }
    throw new ApiError(401, "SESSION_EXPIRED", "The administrator session has expired.");
  }
}

export async function requireAdminRequest(
  request: Request,
  options: { allowUntrackedSession?: boolean } = {}
): Promise<AdminIdentity> {
  if (isDemoMode()) {
    const admin = verifyLocalAdminSession(readCookieValue(request, LOCAL_ADMIN_SESSION_COOKIE));
    if (!admin) throw new ApiError(401, "UNAUTHORIZED", "Authentication is required.");
    return admin;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) {
    throw new ApiError(503, "AUTH_CONFIGURATION_ERROR", "Administrator authentication is not configured.");
  }

  await assertCookieSessionLifetime(request, options.allowUntrackedSession);
  const cookieStore = await cookies();
  const client = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (items) => {
        items.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
      }
    }
  });
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new ApiError(401, "UNAUTHORIZED", "The session is invalid.");
  const claimsResult = await client.auth.getClaims();
  const claims = (claimsResult.data?.claims ?? {}) as VerifiedClaims;
  if (claimsResult.error) throw new ApiError(401, "UNAUTHORIZED", "The session is invalid.");
  try {
    assertValidClaims(claims);
  } catch (error) {
    if (error instanceof ApiError && error.code === "MFA_REQUIRED") {
      await writeRateLimitedAuthAudit(data.user.id, {
        action: "auth.mfa_required_denied",
        targetType: "admin_profile",
        targetId: data.user.id
      });
    }
    throw error;
  }

  return resolveSupabaseAdminIdentity(url, serviceKey, data.user, claims);
}

export async function establishAdminSession(
  tokens: SupabaseSessionTokens
): Promise<AdminIdentity> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) {
    throw new ApiError(503, "AUTH_CONFIGURATION_ERROR", "Administrator authentication is not configured.");
  }

  const cookieStore = await cookies();
  const client = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (items) => {
        items.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
      }
    }
  });
  const sessionResult = await client.auth.setSession({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken
  });
  const accessToken = sessionResult.data.session?.access_token;
  if (sessionResult.error || !sessionResult.data.user || !accessToken) {
    throw new ApiError(401, "UNAUTHORIZED", "The session is invalid.");
  }

  const claimsResult = await client.auth.getClaims(accessToken);
  const claims = (claimsResult.data?.claims ?? {}) as VerifiedClaims;
  if (claimsResult.error) throw new ApiError(401, "UNAUTHORIZED", "The session is invalid.");

  return resolveSupabaseAdminIdentity(url, serviceKey, sessionResult.data.user, claims);
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
  const claimsResult = await client.auth.getClaims();
  const claims = (claimsResult.data?.claims ?? {}) as VerifiedClaims;
  if (claimsResult.error || !claims.iat) redirect("/admin/login?error=session_expired");
  if (isAdminMfaRequired() && claims.aal !== "aal2") {
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
    authenticatedAt: new Date(latestAuthenticationTimestamp(claims) * 1000).toISOString(),
    assuranceLevel: claims.aal ?? "aal1"
  };
}

export async function assertRecentAuthentication(admin: AdminIdentity, maximumAgeMinutes = 10) {
  if (Date.now() - Date.parse(admin.authenticatedAt) > maximumAgeMinutes * 60_000) {
    await writeRateLimitedAuthAudit(admin.userId, {
      actorUserId: admin.userId,
      action: "auth.recent_auth_denied",
      targetType: "auth_session",
      targetId: admin.userId,
      metadata: { maximumAgeMinutes }
    });
    throw new ApiError(
      403,
      "RECENT_AUTHENTICATION_REQUIRED",
      "Please sign in again before completing this sensitive action."
    );
  }
}

export async function assertRecentAal2(admin: AdminIdentity, maximumAgeMinutes = 10) {
  if (isAdminMfaRequired() && admin.assuranceLevel !== "aal2") {
    await writeRateLimitedAuthAudit(admin.userId, {
      actorUserId: admin.userId,
      action: "auth.mfa_required_denied",
      targetType: "auth_session",
      targetId: admin.userId
    });
    throw new ApiError(403, "MFA_REQUIRED", "Multi-factor authentication is required for this action.");
  }
  await assertRecentAuthentication(admin, maximumAgeMinutes);
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
  if (origin && !allowedOrigins.has(origin)) {
    throw new ApiError(403, "ORIGIN_MISMATCH", "The request origin is not allowed.");
  }
  if (isProductionAdminMode() && !origin && fetchSite !== "same-origin") {
    throw new ApiError(403, "ORIGIN_REQUIRED", "A same-origin request is required.");
  }
}
