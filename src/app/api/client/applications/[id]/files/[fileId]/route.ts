import { handleApiError, ok } from "@/lib/api";
import { assertSameOrigin } from "@/lib/auth";
import { requireClientRequest } from "@/lib/client-auth";
import { assertActionRateLimit } from "@/lib/rate-limit";
import { removeApplicationFile } from "@/features/applications/service";
import { applicationRequestContext } from "@/features/applications/request-context";
import { z } from "zod";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const identity = await requireClientRequest(request);
    await assertActionRateLimit(identity.userId, "client-application-file-remove", 30, 15 * 60);
    const { id, fileId } = z.object({ id: z.string().uuid(), fileId: z.string().uuid() }).parse(await params);
    return ok(await removeApplicationFile(identity, id, fileId, applicationRequestContext(request, requestId)), requestId);
  } catch (error) { return handleApiError(error, requestId); }
}
