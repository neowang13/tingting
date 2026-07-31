import { getRepository } from "@/data/repository";
import { handleApiError, ok } from "@/lib/api";
import { requireAdminRequest } from "@/lib/auth";

interface Context {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, context: Context) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    const admin = await requireAdminRequest(request);
    const { id } = await context.params;
    return ok({
      url: await getRepository().tenantRentReceiptUrl(id, admin.userId),
      expiresInSeconds: 300
    }, requestId);
  } catch (error) {
    return handleApiError(error, requestId);
  }
}
