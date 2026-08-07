import { handleApiError } from "@/lib/api";
import { requireClientRequest } from "@/lib/client-auth";
import { applicationReceipt } from "@/features/applications/service";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    const identity = await requireClientRequest(request);
    const id = (await params).id;
    const receipt = await applicationReceipt(identity, id);
    return new Response(receipt, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="application-${id}-receipt.txt"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch (error) {
    return handleApiError(error, requestId);
  }
}
