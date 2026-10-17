import { ApiError } from "@/lib/api";
import type { AdminIdentity } from "@/lib/auth";
import { mcpServiceClient, type McpScope } from "./config";
export interface OAuthClient { client_id: string; client_name: string; redirect_uris: string[] }
export interface OAuthConsent { id: string; client_id: string; admin_user_id: string; redirect_uri: string; resource: string;
  scopes: McpScope[]; state: string; challenge: string; csrf_sha256: string; expires_at: string; consumed_at: string | null }
export interface OAuthGrant { id: string; client_id: string; admin_user_id: string; resource: string; scopes: McpScope[];
  assurance_level: "aal1" | "aal2"; authenticated_at: string; expires_at: string; revoked_at: string | null }
export interface OAuthToken { token_sha256: string; grant_id: string; kind: "access" | "refresh"; expires_at: string; consumed_at: string | null }
interface OAuthCode { code_sha256: string; grant_id: string; redirect_uri: string; challenge: string; expires_at: string; consumed_at: string | null }
declare global { var __tingtingMcpOAuth: { clients: Map<string, OAuthClient>; consents: Map<string, OAuthConsent>;
  grants: Map<string, OAuthGrant>; tokens: Map<string, OAuthToken>; codes: Map<string, OAuthCode> } | undefined }
function memory() {
  globalThis.__tingtingMcpOAuth ??= { clients: new Map(), consents: new Map(), grants: new Map(), tokens: new Map(), codes: new Map() };
  return globalThis.__tingtingMcpOAuth;
}
function unavailable(): never { throw new ApiError(503, "MCP_OAUTH_UNAVAILABLE", "Connection authorization is temporarily unavailable."); }
export async function saveOAuthClient(row: OAuthClient) {
  if (process.env.DATA_BACKEND !== "supabase") { memory().clients.set(row.client_id, row); return; }
  const { error } = await mcpServiceClient().from("mcp_oauth_clients").insert(row); if (error) unavailable();
}
export async function getOAuthClient(id: string): Promise<OAuthClient | null> {
  if (process.env.DATA_BACKEND !== "supabase") return memory().clients.get(id) ?? null;
  const { data, error } = await mcpServiceClient().from("mcp_oauth_clients").select("client_id,client_name,redirect_uris").eq("client_id", id).maybeSingle();
  if (error) unavailable(); return data as OAuthClient | null;
}
export async function saveOAuthConsent(row: OAuthConsent) {
  if (process.env.DATA_BACKEND !== "supabase") { memory().consents.set(row.id, row); return; }
  const { error } = await mcpServiceClient().from("mcp_oauth_consents").insert(row); if (error) unavailable();
}
export async function getOAuthConsent(id: string, adminId: string): Promise<OAuthConsent> {
  let row: OAuthConsent | null | undefined;
  if (process.env.DATA_BACKEND !== "supabase") row = memory().consents.get(id);
  else {
    const { data, error } = await mcpServiceClient().from("mcp_oauth_consents").select("*").eq("id", id).eq("admin_user_id", adminId).maybeSingle();
    if (error) unavailable(); row = data as OAuthConsent | null;
  }
  if (!row || row.admin_user_id !== adminId || row.consumed_at || Date.parse(row.expires_at) <= Date.now()) {
    throw new ApiError(400, "INVALID_CONSENT", "This connection request expired or has already been used. Start the connection again.");
  }
  return row;
}
export async function finishOAuthConsent(input: { id: string; csrfHash: string; admin: AdminIdentity; scopes: McpScope[]; denied: boolean; grantId: string; codeHash: string }) {
  if (process.env.DATA_BACKEND === "supabase") {
    const { data, error } = await mcpServiceClient().rpc("mcp_oauth_authorize", { p_id: input.id, p_csrf_hash: input.csrfHash,
      p_admin_id: input.admin.userId, p_scopes: input.scopes, p_denied: input.denied, p_grant_id: input.grantId,
      p_code_hash: input.codeHash, p_aal: input.admin.assuranceLevel, p_authenticated_at: input.admin.authenticatedAt });
    if (error || !data) throw new ApiError(400, "INVALID_CONSENT", "This connection request is invalid or expired.");
    return data as OAuthConsent;
  }
  const row = await getOAuthConsent(input.id, input.admin.userId);
  if (row.consumed_at || row.csrf_sha256 !== input.csrfHash || (!input.denied && (!input.scopes.length || input.scopes.some(s => !row.scopes.includes(s))))) {
    throw new ApiError(400, "INVALID_CONSENT", "This connection request is invalid or expired.");
  }
  row.consumed_at = new Date().toISOString();
  if (!input.denied) {
    memory().grants.set(input.grantId, { id: input.grantId, client_id: row.client_id, admin_user_id: row.admin_user_id,
      resource: row.resource, scopes: input.scopes, assurance_level: input.admin.assuranceLevel,
      authenticated_at: input.admin.authenticatedAt, expires_at: new Date(Date.now() + 7 * 86400000).toISOString(), revoked_at: null });
    memory().codes.set(input.codeHash, { code_sha256: input.codeHash, grant_id: input.grantId, redirect_uri: row.redirect_uri,
      challenge: row.challenge, expires_at: new Date(Date.now() + 300000).toISOString(), consumed_at: null });
  }
  return row;
}
export interface ExchangeInput { kind: "authorization_code" | "refresh_token"; clientId: string; resource: string;
  codeHash: string; challenge: string; redirectUri: string; refreshHash: string; accessHash: string; nextRefreshHash: string }
export async function exchangeOAuthToken(input: ExchangeInput): Promise<OAuthGrant | null> {
  if (process.env.DATA_BACKEND === "supabase") {
    const { data, error } = await mcpServiceClient().rpc("mcp_oauth_exchange", { p_kind: input.kind, p_client_id: input.clientId,
      p_resource: input.resource, p_code_hash: input.codeHash, p_challenge: input.challenge, p_redirect_uri: input.redirectUri,
      p_refresh_hash: input.refreshHash, p_access_hash: input.accessHash, p_next_refresh_hash: input.nextRefreshHash });
    if (error) unavailable(); return data && !data.error ? data as OAuthGrant : null;
  }
  const db = memory();
  const source = input.kind === "authorization_code" ? db.codes.get(input.codeHash) : db.tokens.get(input.refreshHash);
  if (!source || Date.parse(source.expires_at) <= Date.now()) return null;
  const grant = db.grants.get(source.grant_id);
  if (!grant || grant.client_id !== input.clientId || grant.resource !== input.resource || grant.revoked_at || Date.parse(grant.expires_at) <= Date.now()) return null;
  if (input.kind === "authorization_code") {
    const code = source as OAuthCode;
    if (code.challenge !== input.challenge || code.redirect_uri !== input.redirectUri) return null;
    if (code.consumed_at) { grant.revoked_at = new Date().toISOString(); return null; }
  } else if ((source as OAuthToken).kind !== "refresh") return null;
  else if (source.consumed_at) { grant.revoked_at = new Date().toISOString(); return null; }
  source.consumed_at = new Date().toISOString();
  db.tokens.set(input.accessHash, { token_sha256: input.accessHash, grant_id: grant.id, kind: "access", expires_at: new Date(Math.min(Date.now() + 900000, Date.parse(grant.expires_at))).toISOString(), consumed_at: null });
  db.tokens.set(input.nextRefreshHash, { token_sha256: input.nextRefreshHash, grant_id: grant.id, kind: "refresh", expires_at: grant.expires_at, consumed_at: null });
  return { ...grant };
}
export async function lookupOAuthToken(hash: string): Promise<{ token: OAuthToken; grant: OAuthGrant } | null> {
  if (process.env.DATA_BACKEND !== "supabase") {
    const token = memory().tokens.get(hash); const grant = token && memory().grants.get(token.grant_id);
    return token && grant ? { token: { ...token }, grant: { ...grant } } : null;
  }
  const { data, error } = await mcpServiceClient().from("mcp_oauth_tokens").select("*,grant:mcp_oauth_grants(*)").eq("token_sha256", hash).maybeSingle();
  if (error) unavailable(); if (!data?.grant) return null;
  return { token: data as OAuthToken, grant: data.grant as unknown as OAuthGrant };
}
export async function revokeOAuthGrant(id: string, adminId: string) {
  if (process.env.DATA_BACKEND !== "supabase") {
    const grant = memory().grants.get(id); if (grant?.admin_user_id === adminId) grant.revoked_at = new Date().toISOString(); return;
  }
  const { error } = await mcpServiceClient().from("mcp_oauth_grants").update({ revoked_at: new Date().toISOString() }).eq("id", id).eq("admin_user_id", adminId);
  if (error) unavailable();
}
export async function listOAuthGrants(adminId: string): Promise<Array<Pick<OAuthGrant, "id" | "scopes" | "expires_at" | "revoked_at"> & { client_name: string }>> {
  if (process.env.DATA_BACKEND !== "supabase") return [...memory().grants.values()].filter(g => g.admin_user_id === adminId)
    .map(g => ({ id: g.id, scopes: g.scopes, expires_at: g.expires_at, revoked_at: g.revoked_at, client_name: memory().clients.get(g.client_id)?.client_name ?? "Connected app" }));
  const { data, error } = await mcpServiceClient().from("mcp_oauth_grants").select("id,scopes,expires_at,revoked_at,client:mcp_oauth_clients(client_name)").eq("admin_user_id", adminId).order("created_at", { ascending: false }).limit(100);
  if (error) unavailable();
  return (data ?? []).map(g => ({ id: g.id, scopes: g.scopes as McpScope[], expires_at: g.expires_at, revoked_at: g.revoked_at,
    client_name: (g.client as unknown as { client_name: string }).client_name }));
}
