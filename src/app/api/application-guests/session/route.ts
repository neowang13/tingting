import { z } from "zod";
import { handleApiError, ok, readJson } from "@/lib/api";
import { assertSameOrigin } from "@/lib/auth";
import { assertActionRateLimit } from "@/lib/rate-limit";
import { applicationGuestSecret, hashGuestToken, readGuestCookie, serializeGuestSessionCookie } from "@/lib/application-guest-auth";
import { exchangeCoApplicantInvitation, getGuestApplication } from "@/features/applications/applicant-signing";
import { applicationRequestContext } from "@/features/applications/request-context";

const schema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict();

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const { token } = schema.parse(await readJson(request));
    await assertActionRateLimit(hashGuestToken(token), "application-guest-exchange", 6, 60 * 60);
    const exchanged = await exchangeCoApplicantInvitation(token, applicationRequestContext(request, requestId));
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
    const session = readGuestCookie(request);
    const response = ok(await getGuestApplication(session), requestId);
    response.headers.set("cache-control", "no-store");
    return response;
  } catch (error) {
    return handleApiError(error, requestId);
  }
}
