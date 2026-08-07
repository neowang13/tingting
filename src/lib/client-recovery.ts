import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CLIENT_SUPABASE_COOKIE_NAME } from "@/lib/client-auth-config";

export const CLIENT_RECOVERY_COOKIE_NAME = "tt-client-recovery";
export const CLIENT_RECOVERY_TTL_SECONDS = 10 * 60;

interface RecoveryClaims {
  sub: string;
  exp: number;
}

interface MutableCookieStore {
  getAll(): Array<{ name: string; value: string }>;
  set(name: string, value: string, options: Record<string, unknown>): unknown;
}

function signingKey() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Client recovery signing key is not configured.");
  return key;
}

function signature(payload: string) {
  return createHmac("sha256", signingKey()).update(payload).digest("base64url");
}

export function createClientRecoveryMarker(subject: string, now = Date.now()) {
  const claims: RecoveryClaims = {
    sub: subject,
    exp: Math.floor(now / 1000) + CLIENT_RECOVERY_TTL_SECONDS
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${payload}.${signature(payload)}`;
}

export function verifyClientRecoveryMarker(marker: string | undefined, now = Date.now()): RecoveryClaims | null {
  if (!marker) return null;
  try {
    const [payload, provided, extra] = marker.split(".");
    if (!payload || !provided || extra) return null;
    const expected = signature(payload);
    const expectedBytes = Buffer.from(expected);
    const providedBytes = Buffer.from(provided);
    if (
      expectedBytes.length !== providedBytes.length
      || !timingSafeEqual(expectedBytes, providedBytes)
    ) return null;
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<RecoveryClaims>;
    if (
      typeof claims.sub !== "string"
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(claims.sub)
      || typeof claims.exp !== "number"
      || !Number.isInteger(claims.exp)
      || claims.exp <= Math.floor(now / 1000)
    ) return null;
    return { sub: claims.sub, exp: claims.exp };
  } catch {
    return null;
  }
}

export function clientRecoveryCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge: CLIENT_RECOVERY_TTL_SECONDS
  };
}

export function expireClientRecoveryMarker(store: MutableCookieStore, secure: boolean) {
  store.set(CLIENT_RECOVERY_COOKIE_NAME, "", {
    ...clientRecoveryCookieOptions(secure),
    maxAge: 0
  });
}

export function expireClientRecoverySession(store: MutableCookieStore, secure: boolean) {
  const names = new Set([
    CLIENT_RECOVERY_COOKIE_NAME,
    CLIENT_SUPABASE_COOKIE_NAME,
    ...store.getAll()
      .map(({ name }) => name)
      .filter((name) => name.startsWith(`${CLIENT_SUPABASE_COOKIE_NAME}.`))
  ]);
  for (const name of names) {
    store.set(name, "", {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: 0
    });
  }
}

export async function isEligibleRecoveryClient(service: SupabaseClient, subject: string) {
  const [clientProfile, adminProfile] = await Promise.all([
    service.from("client_profiles")
      .select("is_active")
      .eq("user_id", subject)
      .maybeSingle(),
    service.from("admin_profiles")
      .select("is_active")
      .eq("user_id", subject)
      .maybeSingle()
  ]);
  return Boolean(
    !clientProfile.error
    && clientProfile.data?.is_active
    && !adminProfile.error
    && !adminProfile.data?.is_active
  );
}
