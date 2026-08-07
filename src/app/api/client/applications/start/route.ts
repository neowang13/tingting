import { z } from "zod";
import { startOrReuseClientApplication } from "@/features/applications/service";
import { handleApiError, ok, readJson } from "@/lib/api";
import { assertSameOrigin } from "@/lib/auth";
import { requireClientRequest } from "@/lib/client-auth";
import { assertActionRateLimit } from "@/lib/rate-limit";

const schema = z.object({
  propertySlug: z.string().trim().min(1).max(160).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
}).strict();

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const identity = await requireClientRequest(request);
    await assertActionRateLimit(identity.userId, "client-application-start", 20, 15 * 60);
    const input = schema.parse(await readJson(request));
    const application = await startOrReuseClientApplication(identity, input.propertySlug);
    return ok({ applicationId: application.id }, requestId);
  } catch (error) {
    return handleApiError(error, requestId);
  }
}
