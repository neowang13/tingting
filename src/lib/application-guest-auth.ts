import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { ApiError } from "@/lib/api";

export const APPLICATION_GUEST_COOKIE = "application_guest";

export function createGuestBearerToken() {
  return randomBytes(32).toString("base64url");
}

export function hashGuestToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function signGuestCookieValue(token: string, secret: string) {
  return createHmac("sha256", secret).update(token, "utf8").digest("base64url");
}

export function serializeGuestSessionCookie(token: string, secret: string, expiresAt: Date) {
  const value = `${token}.${signGuestCookieValue(token, secret)}`;
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${APPLICATION_GUEST_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax${secure}; Expires=${expiresAt.toUTCString()}`;
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
    ?? (process.env.NODE_ENV !== "production" ? "development-only-application-guest-secret" : undefined);
  if (!secret || secret.length < 32) {
    throw new ApiError(503, "APPLICATION_GUEST_AUTH_UNAVAILABLE", "Guest application access is unavailable.");
  }
  return secret;
}

export function readGuestCookie(request: Request) {
  const raw = request.headers.get("cookie") ?? "";
  const value = raw.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${APPLICATION_GUEST_COOKIE}=`))
    ?.slice(APPLICATION_GUEST_COOKIE.length + 1);
  const token = parseGuestSessionCookie(value, applicationGuestSecret());
  if (!token) throw new ApiError(401, "APPLICATION_GUEST_SESSION_INVALID", "This guest application session is invalid or expired.");
  return token;
}
