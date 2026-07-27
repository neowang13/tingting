import { handleApiError, ok, ApiError } from "@/lib/api";
import { assertSameOrigin, requireAdminRequest } from "@/lib/auth";
import { listMediaAssets, uploadMediaAsset } from "@/features/content/media-service";

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    await requireAdminRequest(request);
    return ok(await listMediaAssets(), requestId);
  } catch (error) {
    return handleApiError(error, requestId);
  }
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const admin = await requireAdminRequest(request);
    const form = await request.formData();
    const file = form.get("file");
    const altText = form.get("altText");
    if (!(file instanceof File) || typeof altText !== "string") {
      throw new ApiError(400, "INVALID_MEDIA_FORM", "Choose an image and enter alt text.");
    }
    return ok(await uploadMediaAsset(file, altText, admin.userId), requestId, 201);
  } catch (error) {
    return handleApiError(error, requestId);
  }
}
