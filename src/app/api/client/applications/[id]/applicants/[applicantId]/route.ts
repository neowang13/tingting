import { handleApiError, ok } from "@/lib/api";
import { assertSameOrigin } from "@/lib/auth";
import { requireClientRequest } from "@/lib/client-auth";
import { assertActionRateLimit } from "@/lib/rate-limit";
import { revokeCoApplicant } from "@/features/applications/applicant-signing";
import { applicationRequestContext } from "@/features/applications/request-context";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; applicantId: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const identity = await requireClientRequest(request);
    await assertActionRateLimit(identity.userId, "client-application-applicant-revoke", 8, 60 * 60);
    const { id, applicantId } = await params;
    const applicant = await revokeCoApplicant(identity, id, applicantId, applicationRequestContext(request, requestId));
    return ok({ applicant }, requestId);
  } catch (error) {
    return handleApiError(error, requestId);
  }
}
