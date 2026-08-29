import { handleApiError, ok } from "@/lib/api";
import { assertSameOrigin } from "@/lib/auth";
import { requireClientRequest } from "@/lib/client-auth";
import { assertActionRateLimit } from "@/lib/rate-limit";
import { resendCoApplicantInvitation } from "@/features/applications/applicant-signing";
import { applicationRequestContext } from "@/features/applications/request-context";

export async function POST(request: Request, { params }: { params: Promise<{ id: string; applicantId: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const identity = await requireClientRequest(request);
    await assertActionRateLimit(identity.userId, "client-application-applicant-resend", 5, 60 * 60);
    const { id, applicantId } = await params;
    const resent = await resendCoApplicantInvitation(identity, id, applicantId, applicationRequestContext(request, requestId));
    return ok({ applicant: resent.applicant }, requestId);
  } catch (error) {
    return handleApiError(error, requestId);
  }
}
