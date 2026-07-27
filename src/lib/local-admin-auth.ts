import { createHmac, scrypt as nodeScrypt, timingSafeEqual } from "node:crypto";
import { ApiError } from "@/lib/api";

export const LOCAL_ADMIN_SESSION_COOKIE = "tt-admin-session";
export const LOCAL_ADMIN_SESSION_SECONDS = 12 * 60 * 60;

interface LocalAdminSessionPayload {
  version: 1;
  email: string;
  issuedAt: number;
  expiresAt: number;
}

function requiredConfiguration() {
  const email = process.env.LOCAL_ADMIN_EMAIL?.trim().toLowerCase();
  const passwordHash = process.env.LOCAL_ADMIN_PASSWORD_HASH;
  const sessionSecret = process.env.LOCAL_ADMIN_SESSION_SECRET;
  if (!email || !passwordHash || !sessionSecret || sessionSecret.length < 32) {
    throw new ApiError(
      503,
      "LOCAL_AUTH_CONFIGURATION_INCOMPLETE",
      "Administrator sign-in is not configured."
    );
  }
  return {
    email,
    passwordHash,
    sessionSecret,
    displayName: process.env.LOCAL_ADMIN_DISPLAY_NAME?.trim() || "Ting Ting Xu"
  };
}

function scrypt(
  password: string,
  salt: Buffer,
  length: number,
  options: { N: number; r: number; p: number; maxmem: number }
) {
  return new Promise<Buffer>((resolve, reject) => {
    nodeScrypt(password, salt, length, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

export async function verifyLocalAdminCredentials(email: string, password: string) {
  const configuration = requiredConfiguration();
  if (email.trim().toLowerCase() !== configuration.email) return false;

  const [algorithm, nValue, rValue, pValue, saltValue, hashValue] =
    configuration.passwordHash.split(":");
  if (algorithm !== "scrypt" || !nValue || !rValue || !pValue || !saltValue || !hashValue) {
    throw new ApiError(
      503,
      "LOCAL_AUTH_CONFIGURATION_INVALID",
      "Administrator sign-in is not configured."
    );
  }

  const N = Number(nValue);
  const r = Number(rValue);
  const p = Number(pValue);
  const expected = Buffer.from(hashValue, "base64url");
  if (!Number.isSafeInteger(N) || !Number.isSafeInteger(r) || !Number.isSafeInteger(p) || expected.length < 32) {
    throw new ApiError(
      503,
      "LOCAL_AUTH_CONFIGURATION_INVALID",
      "Administrator sign-in is not configured."
    );
  }

  const actual = await scrypt(password, Buffer.from(saltValue, "base64url"), expected.length, {
    N,
    r,
    p,
    maxmem: 64 * 1024 * 1024
  });
  return timingSafeEqual(actual, expected);
}

function sign(encodedPayload: string, secret: string) {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

export function createLocalAdminSession(email: string, now = Date.now()) {
  const configuration = requiredConfiguration();
  const issuedAt = Math.floor(now / 1000);
  const payload: LocalAdminSessionPayload = {
    version: 1,
    email: email.trim().toLowerCase(),
    issuedAt,
    expiresAt: issuedAt + LOCAL_ADMIN_SESSION_SECONDS
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encodedPayload}.${sign(encodedPayload, configuration.sessionSecret)}`;
}

export function verifyLocalAdminSession(token: string | undefined, now = Date.now()) {
  if (!token) return null;

  try {
    const configuration = requiredConfiguration();
    const [encodedPayload, providedSignature, extra] = token.split(".");
    if (!encodedPayload || !providedSignature || extra) return null;

    const expectedSignature = sign(encodedPayload, configuration.sessionSecret);
    const actual = Buffer.from(providedSignature, "utf8");
    const expected = Buffer.from(expectedSignature, "utf8");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;

    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8")
    ) as Partial<LocalAdminSessionPayload>;
    const nowSeconds = Math.floor(now / 1000);
    if (
      payload.version !== 1 ||
      payload.email !== configuration.email ||
      typeof payload.issuedAt !== "number" ||
      typeof payload.expiresAt !== "number" ||
      payload.issuedAt > nowSeconds + 60 ||
      payload.expiresAt <= nowSeconds
    ) {
      return null;
    }

    return {
      userId: "00000000-0000-4000-8000-000000000001",
      email: configuration.email,
      displayName: configuration.displayName,
      authenticatedAt: new Date(payload.issuedAt * 1000).toISOString(),
      assuranceLevel: "aal2" as const
    };
  } catch {
    return null;
  }
}

export function readCookieValue(request: Request, name: string) {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return undefined;
  for (const cookie of cookieHeader.split(";")) {
    const separator = cookie.indexOf("=");
    if (separator < 0) continue;
    if (cookie.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(cookie.slice(separator + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}
