import { z } from "zod";
import { handleApiError, ok, readJson } from "@/lib/api";
import { assertSameOrigin } from "@/lib/auth";
import { requireClientRequest } from "@/lib/client-auth";
import { assertActionRateLimit } from "@/lib/rate-limit";
import { saveApplicationDraft } from "@/features/applications/service";
import { applicationDraftSchema } from "@/features/applications/schemas";

const schema = z.object({
  draft: applicationDraftSchema,
  activeStep: z.number().int().min(1).max(8)
}).strict();

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const identity = await requireClientRequest(request);
    await assertActionRateLimit(identity.userId, "client-application-draft", 60, 15 * 60);
    const result = await saveApplicationDraft(identity, (await params).id, schema.parse(await readJson(request)));
    return ok(result, requestId);
  } catch (error) {
    return handleApiError(error, requestId);
  }
}
