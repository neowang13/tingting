import { ApiError, handleApiError, ok } from "@/lib/api";
import { assertSameOrigin } from "@/lib/auth";
import { requireClientRequest } from "@/lib/client-auth";
import { assertActionRateLimit } from "@/lib/rate-limit";
import { uploadApplicationFile } from "@/features/applications/service";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const identity = await requireClientRequest(request);
    await assertActionRateLimit(identity.userId, "client-application-upload", 12, 15 * 60);
    const data = await request.formData();
    const file = data.get("file");
    if (!(file instanceof File)) throw new ApiError(400, "APPLICATION_FILE_REQUIRED", "Choose a file to upload.");
    const result = await uploadApplicationFile(identity, (await params).id, file);
    return ok(result, requestId, 201);
  } catch (error) {
    return handleApiError(error, requestId);
  }
}
