import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { ApiError } from "@/lib/api";

export const APPLICATION_GUEST_COOKIE = "application_guest";

export function createGuestBearerToken() {
  return randomBytes(32).toString("base64url");
}

export function hashGuestToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

// Reproducible for retries; only the hash is stored in the database or outbox.
export function invitationBearerToken(invitationId: string) {
  return createHmac("sha256", applicationGuestSecret()).update(`co-applicant-invitation:v1:${invitationId}`).digest("base64url");
}

function signGuestCookieValue(token: string, secret: string) {
  return createHmac("sha256", secret).update(token, "utf8").digest("base64url");
}

export function serializeGuestSessionCookie(token: string, secret: string, expiresAt: Date, applicantId?: string) {
  // Bind the selector inside the signature as well as the cookie name. Renaming
  // another applicant's valid cookie must never authorize a different context.
  const payload = applicantId ? `${applicantId}:${token}` : token;
  const value = `${payload}.${signGuestCookieValue(payload, secret)}`;
  const name = applicantId ? `${APPLICATION_GUEST_COOKIE}_${applicantId}` : APPLICATION_GUEST_COOKIE;
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax${secure}; Expires=${expiresAt.toUTCString()}`;
}

export function clearGuestSessionCookie() {
  return `${APPLICATION_GUEST_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function parseGuestSessionCookie(value: string | undefined, secret: string) {
  if (!value) return null;
  const separator = value.lastIndexOf(".");
  if (separator <= 0) return null;
  const token = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  const expected = signGuestCookieValue(token, secret);
  const actualBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) return null;
  return token;
}

export function applicationGuestSecret() {
  const secret = process.env.APPLICATION_GUEST_SESSION_SECRET
    ?? process.env.LOCAL_CLIENT_SESSION_SECRET
    ?? (process.env.SUPABASE_SERVICE_ROLE_KEY ? createHmac("sha256", process.env.SUPABASE_SERVICE_ROLE_KEY).update("silverkey-applicant-session:v1").digest("hex") : undefined)
    ?? (process.env.NODE_ENV !== "production" ? "development-only-application-guest-secret" : undefined);
  if (!secret || secret.length < 32) {
    throw new ApiError(503, "APPLICATION_GUEST_AUTH_UNAVAILABLE", "Guest application access is unavailable.");
  }
  return secret;
}

export function readGuestCookie(request: Request) {
  const applicantId = request.headers.get("x-application-applicant-id");
  // Only the initial, context-free bootstrap may read the legacy latest-session
  // cookie. Old tabs must refresh before reading files or making any changes.
  const bootstrap = request.method === "GET" && new URL(request.url).pathname === "/api/application-guests/session";
  if ((!applicantId && !bootstrap) || (applicantId !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(applicantId))) {
    throw new ApiError(409, "APPLICATION_GUEST_CONTEXT_REQUIRED", "Refresh this page and reopen the intended application before continuing.");
  }
  const name = applicantId ? `${APPLICATION_GUEST_COOKIE}_${applicantId}` : APPLICATION_GUEST_COOKIE;
  const raw = request.headers.get("cookie") ?? "";
  const value = raw.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
  const payload = parseGuestSessionCookie(value, applicationGuestSecret());
  if (!payload || (applicantId && !payload.startsWith(`${applicantId}:`))) {
    throw new ApiError(401, "APPLICATION_GUEST_SESSION_INVALID", "This guest application session is invalid or expired. Reopen this application to continue.");
  }
  return applicantId ? payload.slice(applicantId.length + 1) : payload;
}
