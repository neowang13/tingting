import { getPaperApplicationForm } from "@/features/applications/service";
import { handleApiError } from "@/lib/api";
import { requireClientRequest } from "@/lib/client-auth";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    const identity = await requireClientRequest(request);
    const form = await getPaperApplicationForm(identity, (await params).id);
    return new Response(form.bytes, {
      headers: {
        "Content-Type": form.contentType,
        "Content-Disposition": `attachment; filename="${form.filename.replace(/["\\]/g, "_")}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch (error) {
    return handleApiError(error, requestId);
  }
}
