import { handleApiError, ok, readJson } from "@/lib/api";
import { archiveMediaAsset, updateMediaAltText } from "@/features/content/media-service";
import { assertSameOrigin, requireAdminRequest } from "@/lib/auth";

interface Context {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, context: Context) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    await requireAdminRequest(request);
    const { id } = await context.params;
    const body = await readJson(request) as { altText?: unknown };
    return ok(await updateMediaAltText(id, body.altText), requestId);
  } catch (error) {
    return handleApiError(error, requestId);
  }
}

export async function DELETE(request: Request, context: Context) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    await requireAdminRequest(request);
    const { id } = await context.params;
    await archiveMediaAsset(id);
    return ok({ archived: true }, requestId);
  } catch (error) {
    return handleApiError(error, requestId);
  }
}
