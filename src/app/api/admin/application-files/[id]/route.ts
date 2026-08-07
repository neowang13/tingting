import { z } from "zod";
import { handleApiError, ok, readJson } from "@/lib/api";
import { assertRecentAal2, assertSameOrigin, requireAdminRequest } from "@/lib/auth";
import { getApplicationFileForStaff, reviewApplicationFile } from "@/features/applications/service";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    const admin = await requireAdminRequest(request);
    const result = await getApplicationFileForStaff(admin, (await params).id);
    return new Response(result.bytes, {
      headers: {
        "Content-Type": result.file.mimeType,
        "Content-Disposition": `attachment; filename="${result.file.originalFilename.replace(/["\\]/g, "_")}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Application-Scan-Status": result.file.scanStatus
      }
    });
  } catch (error) {
    return handleApiError(error, requestId);
  }
}

const schema = z.object({ decision: z.enum(["cleared", "rejected"]) });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const admin = await requireAdminRequest(request);
    await assertRecentAal2(admin);
    const result = await reviewApplicationFile(admin, (await params).id, schema.parse(await readJson(request)).decision);
    return ok(result, requestId);
  } catch (error) {
    return handleApiError(error, requestId);
  }
}
