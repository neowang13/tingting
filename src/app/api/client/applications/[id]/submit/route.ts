import { z } from "zod";
import { handleApiError, ok, readJson } from "@/lib/api";
import { assertSameOrigin } from "@/lib/auth";
import { requireClientRequest } from "@/lib/client-auth";
import { assertActionRateLimit } from "@/lib/rate-limit";
import { submitClientApplication } from "@/features/applications/service";
import { applicationRequestContext } from "@/features/applications/request-context";

const schema = z.object({
  signatureLegalName: z.string().trim().min(1).max(160),
  sharingAuthorization: z.literal(true),
  screeningConsent: z.literal(true),
  termsVersion: z.string().min(1).max(80),
  termsSha256: z.string().regex(/^[0-9a-f]{64}$/),
  formVersion: z.string().min(1).max(80),
  formSha256: z.string().regex(/^[0-9a-f]{64}$/)
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const identity = await requireClientRequest(request);
    await assertActionRateLimit(identity.userId, "client-application-submit", 5, 15 * 60);
    const result = await submitClientApplication(identity, (await params).id, schema.parse(await readJson(request)), applicationRequestContext(request, requestId));
    return ok(result, requestId, 202);
  } catch (error) {
    return handleApiError(error, requestId);
  }
}
