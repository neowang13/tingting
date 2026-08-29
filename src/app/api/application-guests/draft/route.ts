import { z } from "zod";
import { handleApiError, ok, readJson } from "@/lib/api";
import { assertSameOrigin } from "@/lib/auth";
import { assertActionRateLimit } from "@/lib/rate-limit";
import { hashGuestToken, readGuestCookie } from "@/lib/application-guest-auth";
import { saveGuestApplicantDraft } from "@/features/applications/applicant-signing";
import { applicationDraftSchema } from "@/features/applications/schemas";
import { applicationRequestContext } from "@/features/applications/request-context";

const schema = z.object({ draft: applicationDraftSchema, activeStep: z.number().int().min(1).max(8) }).strict();

export async function PATCH(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const session = readGuestCookie(request);
    await assertActionRateLimit(hashGuestToken(session), "application-guest-draft", 60, 15 * 60);
    return ok(await saveGuestApplicantDraft(session, schema.parse(await readJson(request)), applicationRequestContext(request, requestId)), requestId);
  } catch (error) {
    return handleApiError(error, requestId);
  }
}
