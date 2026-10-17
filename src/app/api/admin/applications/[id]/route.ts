import { z } from "zod";
import { handleApiError, ok, readJson } from "@/lib/api";
import { assertSameOrigin, requireAdminRequest } from "@/lib/auth";
import { updateApplicationStatus, resendApplicationApproval } from "@/features/applications/service";
import { assertActionRateLimit } from "@/lib/rate-limit";

const schema = z.object({
  status: z.enum(["needs_information", "under_review", "approved", "declined", "withdrawn"])
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const admin = await requireAdminRequest(request);
    const result = await updateApplicationStatus(admin, (await params).id, schema.parse(await readJson(request)).status);
    return ok(result, requestId);
  } catch (error) {
    return handleApiError(error, requestId);
  }
}

const resendSchema = z.object({ action: z.literal("resend_approval"), deliveryId: z.uuid() }).strict();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const admin = await requireAdminRequest(request);
    const input = resendSchema.parse(await readJson(request));
    await assertActionRateLimit(admin.userId, "application-approval-email", 10, 15 * 60);
    return ok(await resendApplicationApproval(admin, (await params).id, input.deliveryId), requestId);
  } catch (error) {
    return handleApiError(error, requestId);
  }
}
