import { ApiError, handleApiError, ok } from "@/lib/api";
import { assertRecentAal2, assertSameOrigin, requireAdminRequest } from "@/lib/auth";
import { assertActionRateLimit } from "@/lib/rate-limit";
import { uploadSignedLeaseForStaff } from "@/features/applications/service";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const admin = await requireAdminRequest(request);
    await assertRecentAal2(admin);
    await assertActionRateLimit(admin.userId, "application-lease-upload", 10, 15 * 60);
    const data = await request.formData();
    const file = data.get("file");
    if (!(file instanceof File)) {
      throw new ApiError(400, "LEASE_FILE_REQUIRED", "Choose the signed tenancy agreement PDF.");
    }
    return ok(await uploadSignedLeaseForStaff(admin, (await params).id, file), requestId, 201);
  } catch (error) {
    return handleApiError(error, requestId);
  }
}
