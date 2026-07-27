import { z } from "zod";
import { handleApiError, ok, readJson } from "@/lib/api";
import { assertSameOrigin } from "@/lib/auth";
import { assertActionRateLimit } from "@/lib/rate-limit";
import {
  maskAuditEmail,
  securityFingerprint,
  writeSecurityAudit
} from "@/lib/security-audit";

const failureEventSchema = z.object({
  event: z.enum(["login_failed", "mfa_challenge_failed"]),
  email: z.string().email().max(254).optional(),
  reason: z.enum([
    "invalid_credentials",
    "invalid_or_expired_code",
    "enrollment_failed",
    "session_establishment_failed"
  ])
});

function sourceAddress(request: Request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const input = failureEventSchema.parse(await readJson(request));
    const sourceKey = securityFingerprint(sourceAddress(request));
    await assertActionRateLimit(sourceKey, `security-audit:${input.event}`, 10, 15 * 60);

    const metadata: Record<string, string> = { reason: input.reason };
    if (input.email) {
      const accountKey = securityFingerprint(input.email);
      await assertActionRateLimit(accountKey, `security-audit:${input.event}`, 6, 15 * 60);
      metadata.accountMasked = maskAuditEmail(input.email);
      metadata.accountFingerprint = accountKey;
    }

    await writeSecurityAudit({
      action: `auth.${input.event}`,
      targetType: "auth_attempt",
      metadata
    });
    return ok({ recorded: true }, requestId, 202);
  } catch (error) {
    return handleApiError(error, requestId);
  }
}
