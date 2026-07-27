import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

type AuditMetadataValue = string | number | boolean | null;

export interface SecurityAuditInput {
  actorUserId?: string | null;
  action: string;
  targetType: "auth_attempt" | "auth_session" | "admin_profile";
  targetId?: string | null;
  metadata?: Record<string, AuditMetadataValue>;
}

declare global {
  var __tingtingSecurityAudit: Array<SecurityAuditInput & { createdAt: string }> | undefined;
}

function normalizedMetadata(metadata: SecurityAuditInput["metadata"]) {
  const allowedKeys = new Set([
    "accountFingerprint",
    "accountMasked",
    "assuranceLevel",
    "maximumAgeMinutes",
    "reason"
  ]);
  return Object.fromEntries(
    Object.entries(metadata ?? {}).filter(([key, value]) =>
      allowedKeys.has(key) &&
      (value === null || ["string", "number", "boolean"].includes(typeof value))
    )
  );
}

export function securityFingerprint(value: string) {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

export function maskAuditEmail(value: string) {
  const [local, domain] = value.trim().toLowerCase().split("@");
  if (!local || !domain) return "invalid";
  return `${local.slice(0, 1)}***@${domain}`;
}

/**
 * Security denials must remain fail-closed even when the audit sink is unavailable,
 * so this writer is deliberately best-effort and never leaks database errors.
 */
export async function writeSecurityAudit(input: SecurityAuditInput) {
  const event = {
    ...input,
    actorUserId: input.actorUserId ?? null,
    targetId: input.targetId ?? null,
    metadata: normalizedMetadata(input.metadata)
  };

  if (process.env.DATA_BACKEND !== "supabase") {
    globalThis.__tingtingSecurityAudit ??= [];
    globalThis.__tingtingSecurityAudit.push({ ...event, createdAt: new Date().toISOString() });
    return true;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return false;

  try {
    const client = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { error } = await client.from("audit_events").insert({
      actor_user_id: event.actorUserId,
      action: event.action,
      target_type: event.targetType,
      target_id: event.targetId,
      metadata: event.metadata
    });
    return !error;
  } catch {
    return false;
  }
}
