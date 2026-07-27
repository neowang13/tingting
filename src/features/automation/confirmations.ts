import { createHash } from "node:crypto";
import type {
  AutomationConfirmationAction,
  AutomationConfirmationIntent
} from "@/features/automation/contracts";
import { ApiError } from "@/lib/api";

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
    .join(",")}}`;
}

export function sha256Digest(value: unknown) {
  const input =
    typeof value === "string" || value instanceof Uint8Array
      ? value
      : value instanceof ArrayBuffer
        ? new Uint8Array(value)
        : canonicalJson(value);
  return `sha256:${createHash("sha256").update(input).digest("hex")}`;
}

export function createConfirmationDigest(input: {
  serviceAccountId: string;
  action: AutomationConfirmationAction;
  targetType: string;
  targetId: string;
  targetVersion: string | null;
  payload: Record<string, unknown>;
  expiresAt: string;
}) {
  return sha256Digest(input);
}

export function assertConfirmationExecutable(
  intent: AutomationConfirmationIntent,
  serviceAccountId: string,
  digest: string,
  acknowledged: string[]
) {
  if (intent.serviceAccountId !== serviceAccountId) {
    throw new ApiError(403, "CONFIRMATION_REQUIRED", "This confirmation belongs to another service account.");
  }
  if (intent.consumedAt) {
    throw new ApiError(409, "CONFIRMATION_CONSUMED", "This confirmation has already been used.");
  }
  if (Date.parse(intent.expiresAt) <= Date.now()) {
    throw new ApiError(410, "CONFIRMATION_EXPIRED", "This confirmation has expired.");
  }
  if (intent.digest !== digest) {
    throw new ApiError(409, "PREVIEW_STALE", "The confirmation digest no longer matches the preview.");
  }
  const acknowledgedSet = new Set(acknowledged);
  const missing = intent.requiredAcknowledgements.filter((item) => !acknowledgedSet.has(item));
  if (missing.length > 0) {
    throw new ApiError(422, "ACKNOWLEDGEMENT_REQUIRED", "Required acknowledgements are missing.", { missing });
  }
}
