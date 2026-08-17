import { handleApiError } from "@/lib/api";
import { requireAdminRequest } from "@/lib/auth";
import { getSignedLeaseForStaff } from "@/features/applications/service";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    const admin = await requireAdminRequest(request);
    const result = await getSignedLeaseForStaff(admin, (await params).id);
    return new Response(result.bytes, {
      headers: {
        "Content-Type": result.file.mimeType,
        "Content-Disposition": `attachment; filename="${result.file.originalFilename.replace(/["\\]/g, "_")}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch (error) {
    return handleApiError(error, requestId);
  }
}
