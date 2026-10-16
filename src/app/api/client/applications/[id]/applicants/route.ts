import { handleApiError, ok, readJson } from "@/lib/api";
import { assertSameOrigin } from "@/lib/auth";
import { requireClientRequest } from "@/lib/client-auth";
import { assertActionRateLimit } from "@/lib/rate-limit";
import { createCoApplicantInvitation, getApplicationApplicants } from "@/features/applications/applicant-signing";
import { coApplicantInvitationSchema } from "@/features/applications/schemas";
import { applicationRequestContext } from "@/features/applications/request-context";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const identity = await requireClientRequest(request);
    await assertActionRateLimit(identity.userId, "client-application-applicant-invite", 8, 60 * 60);
    const created = await createCoApplicantInvitation(identity, (await params).id, coApplicantInvitationSchema.parse(await readJson(request)), applicationRequestContext(request, requestId));
    return ok({ applicant: created.applicant, invitationId: created.invitationId }, requestId, 201);
  } catch (error) {
    return handleApiError(error, requestId);
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    const identity = await requireClientRequest(request);
    const response = ok({ applicants: await getApplicationApplicants(identity, (await params).id) }, requestId);
    response.headers.set("cache-control", "no-store");
    return response;
  } catch (error) { return handleApiError(error, requestId); }
}
