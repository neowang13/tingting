import { createHmac, timingSafeEqual } from "node:crypto";
import { ApiError } from "@/lib/api";

interface TestSendPreviewClaims {
  actorId: string;
  tenantId: string;
  channel: "email" | "sms";
  templateId: string;
  templateVersion: string;
  requestId: string;
  dueDate: string;
  leadDays: number;
  localTime: string;
  timezone: string;
  renderedSubject: string | null;
  renderedBody: string;
  destination: string;
  expiresAt: number;
}

function signingKey() {
  const key =
    process.env.TEST_SEND_PREVIEW_SIGNING_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.LOCAL_ADMIN_SESSION_SECRET;
  if (!key) {
    throw new ApiError(
      503,
      "TEST_PREVIEW_CONFIGURATION_ERROR",
      "Test-send preview confirmation is not configured."
    );
  }
  return key;
}

function signature(payload: string) {
  return createHmac("sha256", signingKey()).update(payload).digest("base64url");
}

export function createTestSendPreviewToken(
  input: Omit<TestSendPreviewClaims, "expiresAt">,
  now = Date.now()
) {
  const payload = Buffer.from(JSON.stringify({
    ...input,
    expiresAt: now + 10 * 60_000
  } satisfies TestSendPreviewClaims)).toString("base64url");
  return `${payload}.${signature(payload)}`;
}

export function verifyTestSendPreviewToken(
  token: string,
  expected: Pick<
    TestSendPreviewClaims,
    "actorId" | "tenantId" | "channel" | "templateId" | "requestId"
  >,
  now = Date.now()
) {
  try {
    const [payload, providedSignature, extra] = token.split(".");
    if (!payload || !providedSignature || extra) throw new Error("invalid token");
    const expectedSignature = signature(payload);
    const actual = Buffer.from(providedSignature);
    const calculated = Buffer.from(expectedSignature);
    if (actual.length !== calculated.length || !timingSafeEqual(actual, calculated)) {
      throw new Error("invalid signature");
    }
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString()) as TestSendPreviewClaims;
    if (
      claims.expiresAt <= now ||
      claims.actorId !== expected.actorId ||
      claims.tenantId !== expected.tenantId ||
      claims.channel !== expected.channel ||
      claims.templateId !== expected.templateId ||
      claims.requestId !== expected.requestId
    ) {
      throw new Error("expired or mismatched claims");
    }
    return claims;
  } catch {
    throw new ApiError(
      409,
      "TEST_PREVIEW_REQUIRED",
      "Create and confirm a current test-send preview before queuing."
    );
  }
}
