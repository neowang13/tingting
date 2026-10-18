import { after } from "next/server";
import { processApplicationFileCleanup } from "@/features/applications/file-cleanup";
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
    const result = await removeApplicationFile(identity, id, fileId, applicationRequestContext(request, requestId));
    after(() => processApplicationFileCleanup({ fileId, limit: 1 }).catch(() => { console.error(JSON.stringify({ level: "error", message: "File cleanup deferred to Cron", requestId })); }));
    return ok(result, requestId);
  } catch (error) { return handleApiError(error, requestId); }
}
