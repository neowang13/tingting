import { handleApiError, ok, readJson } from "@/lib/api";
import { assertSameOrigin, requireAdminRequest } from "@/lib/auth";
import { applicationTenantConversionSchema } from "@/features/applications/schemas";
import { convertApprovedApplicationToTenant } from "@/features/applications/service";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const admin = await requireAdminRequest(request);
    const input = applicationTenantConversionSchema.parse(await readJson(request));
    return ok(
      await convertApprovedApplicationToTenant(admin, (await params).id, input),
      requestId,
      201
    );
  } catch (error) {
    return handleApiError(error, requestId);
  }
}
