import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes
} from "node:crypto";
import { normalizeDialablePhone } from "@/features/contact/follow-up";

export interface ShowingContactClaims {
  phone: string;
  requesterName: string;
  propertyTitle: string;
  requestedTime: string;
  expiresAt: number;
}

function encryptionKey() {
  const secret = process.env.SHOWING_CONTACT_LINK_SECRET
    || process.env.LOCAL_ADMIN_SESSION_SECRET;
  return secret ? createHash("sha256").update(secret).digest() : null;
}

export function createShowingContactToken(input: {
  phone: string;
  requesterName: string;
  propertyTitle: string;
  requestedTime: string;
}, now = Date.now()) {
  const key = encryptionKey();
  const phone = normalizeDialablePhone(input.phone);
  if (!key || !phone) return null;

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const payload = Buffer.from(JSON.stringify({
    phone,
    requesterName: input.requesterName,
    propertyTitle: input.propertyTitle,
    requestedTime: input.requestedTime,
    expiresAt: now + 14 * 24 * 60 * 60_000
  } satisfies ShowingContactClaims));
  const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64url");
}

export function readShowingContactToken(token: string, now = Date.now()): ShowingContactClaims | null {
  const key = encryptionKey();
  if (!key) return null;

  try {
    const packed = Buffer.from(token, "base64url");
    if (packed.length < 29) return null;
    const iv = packed.subarray(0, 12);
    const authTag = packed.subarray(12, 28);
    const encrypted = packed.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    const claims = JSON.parse(Buffer.concat([
      decipher.update(encrypted),
      decipher.final()
    ]).toString()) as ShowingContactClaims;

    const phone = normalizeDialablePhone(claims.phone);
    if (
      !phone
      || phone !== claims.phone
      || !claims.requesterName
      || !claims.propertyTitle
      || !claims.requestedTime
      || !Number.isFinite(claims.expiresAt)
      || claims.expiresAt <= now
    ) return null;

    return claims;
  } catch {
    return null;
  }
}

export function createShowingContactUrl(input: {
  appBaseUrl?: string | null;
  phone: string;
  requesterName: string;
  propertyTitle: string;
  requestedTime: string;
}) {
  if (!input.appBaseUrl) return null;
  try {
    const baseUrl = new URL(input.appBaseUrl);
    if (!["http:", "https:"].includes(baseUrl.protocol)) return null;
    const token = createShowingContactToken(input);
    return token
      ? new URL(`/contact-requester/${encodeURIComponent(token)}`, baseUrl).toString()
      : null;
  } catch {
    return null;
  }
}
