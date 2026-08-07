import { z } from "zod";
import { handleApiError, ok, readJson } from "@/lib/api";
import { assertSameOrigin, requireAdminRequest } from "@/lib/auth";
import { updateApplicationStatus } from "@/features/applications/service";

const schema = z.object({
  status: z.enum(["received", "needs_information", "under_review", "approved", "declined", "withdrawn"])
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
