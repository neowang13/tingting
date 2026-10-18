import { after } from "next/server";
import { processApplicationFileCleanup } from "@/features/applications/file-cleanup";
import { handleApiError, ok } from "@/lib/api";
import { assertSameOrigin } from "@/lib/auth";
import { requireClientRequest } from "@/lib/client-auth";
import { assertActionRateLimit } from "@/lib/rate-limit";
import { readGuestCookie } from "@/lib/application-guest-auth";
import { removeGuestApplicantFile } from "@/features/applications/applicant-signing";
import { applicationRequestContext } from "@/features/applications/request-context";
import { z } from "zod";

export async function DELETE(request: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const identity = await requireClientRequest(request);
    const session = readGuestCookie(request);
    await assertActionRateLimit(identity.userId, "guest-application-file-remove", 30, 15 * 60);
    const { fileId } = z.object({ fileId: z.string().uuid() }).parse(await params);
    const result = await removeGuestApplicantFile(session, fileId, identity, applicationRequestContext(request, requestId));
    after(() => processApplicationFileCleanup({ fileId, limit: 1 }).catch(() => { console.error(JSON.stringify({ level: "error", message: "File cleanup deferred to Cron", requestId })); }));
    return ok(result, requestId);
  } catch (error) { return handleApiError(error, requestId); }
}
