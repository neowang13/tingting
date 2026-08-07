import { createHmac, scrypt as nodeScrypt, timingSafeEqual } from "node:crypto";
import { ApiError } from "@/lib/api";

export const LOCAL_CLIENT_SESSION_COOKIE = "tt-client-session";
export const LOCAL_CLIENT_SESSION_SECONDS = 60 * 60;
export const LOCAL_CLIENT_USER_ID = "00000000-0000-4000-8000-000000000009";

interface Payload {
  version: 1;
  userId: string;
  email: string;
  issuedAt: number;
  expiresAt: number;
}

function configuration() {
  const email = (process.env.LOCAL_CLIENT_EMAIL || "client@example.test").trim().toLowerCase();
  const passwordHash = process.env.LOCAL_CLIENT_PASSWORD_HASH || process.env.LOCAL_ADMIN_PASSWORD_HASH;
  const secret = process.env.LOCAL_CLIENT_SESSION_SECRET || process.env.LOCAL_ADMIN_SESSION_SECRET;
  if (!email || !passwordHash || !secret || secret.length < 32) {
    throw new ApiError(503, "CLIENT_AUTH_CONFIGURATION_INCOMPLETE", "Client sign-in is not configured.");
  }
  return {
    email,
    passwordHash,
    secret,
    displayName: process.env.LOCAL_CLIENT_DISPLAY_NAME?.trim() || "Demo Applicant"
  };
}

function derive(password: string, salt: Buffer, length: number, options: { N: number; r: number; p: number; maxmem: number }) {
  return new Promise<Buffer>((resolve, reject) => {
    nodeScrypt(password, salt, length, options, (error, key) => error ? reject(error) : resolve(key));
  });
}

export async function verifyLocalClientCredentials(email: string, password: string) {
  const config = configuration();
  if (email.trim().toLowerCase() !== config.email) return false;
  const [algorithm, nValue, rValue, pValue, saltValue, hashValue] = config.passwordHash.split(":");
  if (algorithm !== "scrypt" || !nValue || !rValue || !pValue || !saltValue || !hashValue) {
    throw new ApiError(503, "CLIENT_AUTH_CONFIGURATION_INVALID", "Client sign-in is not configured.");
  }
  const N = Number(nValue);
  const r = Number(rValue);
  const p = Number(pValue);
  const expected = Buffer.from(hashValue, "base64url");
  const actual = await derive(password, Buffer.from(saltValue, "base64url"), expected.length, {
    N,
    r,
    p,
    maxmem: 64 * 1024 * 1024
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function signature(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function createLocalClientSession(email: string, now = Date.now()) {
  const config = configuration();
  const issuedAt = Math.floor(now / 1000);
  const payload: Payload = {
    version: 1,
    userId: LOCAL_CLIENT_USER_ID,
    email: email.trim().toLowerCase(),
    issuedAt,
    expiresAt: issuedAt + LOCAL_CLIENT_SESSION_SECONDS
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${signature(encoded, config.secret)}`;
}

export function verifyLocalClientSession(token: string | undefined, now = Date.now()) {
  if (!token) return null;
  try {
    const config = configuration();
    const [encoded, provided, extra] = token.split(".");
    if (!encoded || !provided || extra) return null;
    const expected = signature(encoded, config.secret);
    if (provided.length !== expected.length || !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) return null;
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Partial<Payload>;
    const nowSeconds = Math.floor(now / 1000);
    if (payload.version !== 1 || payload.userId !== LOCAL_CLIENT_USER_ID || payload.email !== config.email ||
        typeof payload.issuedAt !== "number" || typeof payload.expiresAt !== "number" ||
        payload.issuedAt > nowSeconds + 60 || payload.expiresAt <= nowSeconds) return null;
    return { userId: payload.userId, email: config.email, displayName: config.displayName };
  } catch {
    return null;
  }
}
