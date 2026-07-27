import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { AutomationActor, AutomationScope } from "@/features/automation/contracts";
import { ApiError } from "@/lib/api";

const TOKEN_PATTERN = /^tta_([A-Za-z0-9_-]{8,20})_([A-Za-z0-9_-]{40,})$/;

export interface AutomationTokenLookup {
  id: string;
  prefix: string;
  tokenHash: string;
  isActive: boolean;
  expiresAt: string | null;
  revokedAt: string | null;
  serviceAccount: {
    id: string;
    name: string;
    delegatedAdminUserId: string;
    delegatedAdminActive: boolean;
    scopes: AutomationScope[];
    isActive: boolean;
    expiresAt: string | null;
  };
}

export function generateAutomationToken(pepper: string) {
  const prefix = randomBytes(9).toString("base64url");
  const secret = randomBytes(32).toString("base64url");
  const token = `tta_${prefix}_${secret}`;
  return { token, prefix, tokenHash: hashAutomationToken(token, pepper) };
}

export function hashAutomationToken(token: string, pepper: string) {
  return createHmac("sha256", pepper).update(token, "utf8").digest("hex");
}

export function parseAutomationToken(value: string | null) {
  const match = value?.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new ApiError(401, "AUTOMATION_UNAUTHORIZED", "Automation authentication is required.");
  const parsed = TOKEN_PATTERN.exec(match[1]);
  if (!parsed) throw new ApiError(401, "AUTOMATION_UNAUTHORIZED", "The automation token is invalid.");
  return { token: match[1], prefix: parsed[1] };
}

export function constantTimeTokenMatch(actualHash: string, expectedHash: string) {
  const actual = Buffer.from(actualHash, "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function validateAutomationToken(
  token: string,
  lookup: AutomationTokenLookup | null,
  pepper: string,
  requestId: string
): AutomationActor {
  if (!lookup || !constantTimeTokenMatch(hashAutomationToken(token, pepper), lookup.tokenHash)) {
    throw new ApiError(401, "AUTOMATION_UNAUTHORIZED", "The automation token is invalid.");
  }
  const now = Date.now();
  if (
    !lookup.isActive ||
    lookup.revokedAt ||
    (lookup.expiresAt && Date.parse(lookup.expiresAt) <= now) ||
    !lookup.serviceAccount.isActive ||
    !lookup.serviceAccount.delegatedAdminActive ||
    (lookup.serviceAccount.expiresAt && Date.parse(lookup.serviceAccount.expiresAt) <= now)
  ) {
    throw new ApiError(401, "AUTOMATION_TOKEN_INACTIVE", "The automation token is inactive.");
  }
  return {
    serviceAccountId: lookup.serviceAccount.id,
    serviceAccountName: lookup.serviceAccount.name,
    delegatedAdminUserId: lookup.serviceAccount.delegatedAdminUserId,
    requestId,
    scopes: lookup.serviceAccount.scopes
  };
}

