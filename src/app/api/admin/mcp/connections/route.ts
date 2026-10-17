import { z } from "zod";
import { requireAdminRequest, assertSameOrigin } from "@/lib/auth";
import { ok, handleApiError, readJson } from "@/lib/api";
import { mcpOrigin } from "@/features/mcp/config";
import { revokeOAuthGrant } from "@/features/mcp/oauth-store";
export async function DELETE(request: Request) {
  try {
    mcpOrigin(); assertSameOrigin(request); const admin = await requireAdminRequest(request);
    const { id } = z.object({ id: z.uuid() }).strict().parse(await readJson(request));
    await revokeOAuthGrant(id, admin.userId); return ok({ revoked: true });
  } catch (error) { return handleApiError(error); }
}
