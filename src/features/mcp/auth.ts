import type { AdminIdentity } from "@/lib/auth";
import { ApiError } from "@/lib/api";
import { assertActionRateLimit } from "@/lib/rate-limit";
import { mcpOrigin, mcpResource, mcpServiceClient, tokenHash, type McpScope } from "./config";
import { lookupOAuthToken } from "./oauth-store";
export { mcpScopes, mcpServiceClient, type McpScope } from "./config";
export interface McpPrincipal { credentialId: string; admin: AdminIdentity; scopes: McpScope[] }

export function assertMcpScope(principal: McpPrincipal, scope: McpScope) {
  if (!principal.scopes.includes(scope)) throw new ApiError(403, "MCP_SCOPE_DENIED", "This connection does not permit this tool.");
}
export async function verifyConnectedAdmin(adminId: string) {
  if (process.env.DATA_BACKEND !== "supabase") return { email: process.env.LOCAL_ADMIN_EMAIL ?? "", displayName: "Local administrator" };
  const client = mcpServiceClient();
  const [{ data: profile, error }, user] = await Promise.all([
    client.from("admin_profiles").select("is_active,display_name").eq("user_id", adminId).maybeSingle(),
    client.auth.admin.getUserById(adminId)
  ]);
  if (error || user.error) throw new ApiError(503, "MCP_UNAVAILABLE", "The administrator could not be verified.");
  const bannedUntil = user.data.user?.banned_until;
  if (!profile?.is_active || !user.data.user || (bannedUntil && Date.parse(bannedUntil) > Date.now())) {
    throw new ApiError(403, "MCP_ADMIN_INACTIVE", "The connected administrator is inactive.");
  }
  return { email: user.data.user.email ?? "", displayName: String(profile.display_name) };
}
export async function authenticateMcp(request: Request): Promise<McpPrincipal> {
  const origin = mcpOrigin();
  const allowed = new Set([origin, ...(process.env.MCP_ALLOWED_ORIGINS ?? "").split(",").map(s => s.trim()).filter(Boolean)]);
  const incomingOrigin = request.headers.get("origin");
  if (incomingOrigin && !allowed.has(incomingOrigin)) throw new ApiError(403, "MCP_ORIGIN_DENIED", "This origin is not allowed.");
  const token = /^Bearer ([A-Za-z0-9_-]{43,256})$/.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!token) throw new ApiError(401, "MCP_UNAUTHORIZED", "Connect using your website Admin account.");
  const record = await lookupOAuthToken(tokenHash(token));
  const now = Date.now();
  if (!record || record.token.kind !== "access" || Date.parse(record.token.expires_at) <= now || record.grant.revoked_at
    || Date.parse(record.grant.expires_at) <= now || record.grant.resource !== mcpResource()
    || (process.env.NEXT_PUBLIC_ADMIN_MFA_REQUIRED === "true" && record.grant.assurance_level !== "aal2")) {
    throw new ApiError(401, "MCP_UNAUTHORIZED", "This connection expired or was revoked. Sign in with Admin to connect again.");
  }
  await assertActionRateLimit(record.grant.id, "mcp-request", 120, 60);
  const profile = await verifyConnectedAdmin(record.grant.admin_user_id);
  return { credentialId: record.grant.id, scopes: record.grant.scopes,
    admin: { userId: record.grant.admin_user_id, ...profile, authenticatedAt: record.grant.authenticated_at,
      assuranceLevel: record.grant.assurance_level } };
}
