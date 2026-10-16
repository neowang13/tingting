import { requireClientRequest } from "@/lib/client-auth";
import { assertGuestAccount, resumeCoApplicantApplication, acceptCoApplicantInvitationById } from "@/features/applications/applicant-signing";
import { z } from "zod";
import { handleApiError, ok, readJson } from "@/lib/api";
import { assertSameOrigin } from "@/lib/auth";
import { assertActionRateLimit } from "@/lib/rate-limit";
import { applicationGuestSecret, readGuestCookie, serializeGuestSessionCookie } from "@/lib/application-guest-auth";
import { exchangeCoApplicantInvitation, getGuestApplication } from "@/features/applications/applicant-signing";
import { applicationRequestContext } from "@/features/applications/request-context";

const schema = z.union([z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict(), z.object({ applicantId: z.uuid() }).strict(), z.object({ invitationId: z.uuid() }).strict()]);

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const identity = await requireClientRequest(request);
    const input = schema.parse(await readJson(request));
    await assertActionRateLimit(identity.userId, "application-linked-exchange", 12, 60 * 60);
    const exchanged = "token" in input ? await exchangeCoApplicantInvitation(input.token, applicationRequestContext(request, requestId), identity) : "invitationId" in input ? await acceptCoApplicantInvitationById(input.invitationId, applicationRequestContext(request, requestId), identity) : await resumeCoApplicantApplication(identity, input.applicantId);
    const response = ok(await getGuestApplication(exchanged.sessionToken), requestId);
    response.headers.append("set-cookie", serializeGuestSessionCookie(exchanged.sessionToken, applicationGuestSecret(), new Date(exchanged.expiresAt)));
    response.headers.set("cache-control", "no-store");
    return response;
  } catch (error) {
    return handleApiError(error, requestId);
  }
}

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const identity = await requireClientRequest(request);
    const session = readGuestCookie(request);
    await assertGuestAccount(session, identity);
    const response = ok(await getGuestApplication(session), requestId);
    response.headers.set("cache-control", "no-store");
    return response;
  } catch (error) {
    return handleApiError(error, requestId);
  }
}
