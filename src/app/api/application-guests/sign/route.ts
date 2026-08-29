import { handleApiError, ok, readJson } from "@/lib/api";
import { assertSameOrigin } from "@/lib/auth";
import { assertActionRateLimit } from "@/lib/rate-limit";
import { hashGuestToken, readGuestCookie } from "@/lib/application-guest-auth";
import { signGuestApplicant } from "@/features/applications/applicant-signing";
import { applicantSignatureSchema } from "@/features/applications/schemas";
import { applicationRequestContext } from "@/features/applications/request-context";

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const session = readGuestCookie(request);
    await assertActionRateLimit(hashGuestToken(session), "application-guest-sign", 5, 15 * 60);
    const applicant = await signGuestApplicant(session, applicantSignatureSchema.parse(await readJson(request)), applicationRequestContext(request, requestId));
    return ok({ applicant }, requestId);
  } catch (error) {
    return handleApiError(error, requestId);
  }
}
