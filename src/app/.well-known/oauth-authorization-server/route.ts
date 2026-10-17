import { authorizationMetadata, oauthError } from "@/features/mcp/oauth-http";
export const dynamic = "force-dynamic";
export function GET() {
  try { return Response.json(authorizationMetadata(), { headers: { "cache-control": "no-store" } }); }
  catch (error) { return oauthError(error); }
}
