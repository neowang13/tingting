import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError } from "@/lib/api";
import { requireAdminRequest, assertSameOrigin, assertRecentAuthentication } from "@/lib/auth";
import { readCookieValue } from "@/lib/local-admin-auth";
import { assertActionRateLimit } from "@/lib/rate-limit";
import { mcpOrigin, mcpResource, mcpScopes, tokenHash, type McpScope } from "./config";
import { verifyConnectedAdmin } from "./auth";
import { getOAuthClient, saveOAuthClient, saveOAuthConsent, finishOAuthConsent, exchangeOAuthToken, lookupOAuthToken, revokeOAuthGrant } from "./oauth-store";

export const CONSENT_COOKIE = "tt-mcp-consent";
const noStore = { "cache-control": "no-store", "pragma": "no-cache" };
const secret = () => randomBytes(32).toString("base64url");
export function parseScopes(value: string | undefined): McpScope[] {
  const scopes = [...new Set((value ?? mcpScopes.join(" ")).split(/\s+/).filter(Boolean))];
  if (!scopes.length || scopes.some(s => !(mcpScopes as readonly string[]).includes(s))) throw new ApiError(400, "invalid_scope", "Unsupported permissions.");
  return scopes as McpScope[];
}
function safeRedirect(value: string) {
  const url = new URL(value);
  if (url.username || url.password || url.hash || (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))) {
    throw new ApiError(400, "invalid_redirect_uri", "A registered HTTPS callback is required.");
  }
  if (["code", "state", "error"].some(key => url.searchParams.has(key))) throw new ApiError(400, "invalid_redirect_uri", "Callback contains reserved parameters.");
  return value;
}
export function protectedMetadata() { return { resource: mcpResource(), authorization_servers: [mcpOrigin()], scopes_supported: [...mcpScopes], bearer_methods_supported: ["header"] }; }
export function authorizationMetadata() {
  const origin = mcpOrigin(); const base = `${origin}/api/mcp/oauth`;
  return { issuer: origin, authorization_endpoint: `${base}/authorize`, token_endpoint: `${base}/token`, registration_endpoint: `${base}/register`,
    revocation_endpoint: `${base}/revoke`, response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"], code_challenge_methods_supported: ["S256"], scopes_supported: [...mcpScopes] };
}
async function smallBody(request: Request, form = false) {
  // Stream size is checked even if Content-Length is absent or misleading.
  const reader = request.body?.getReader(); let size = 0; const chunks: Uint8Array[] = [];
  if (reader) while (true) {
    const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length;
    if (size > 16384) { await reader.cancel(); throw new ApiError(413, "invalid_request", "Request is too large."); }
    chunks.push(chunk.value);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (form) {
    if (!request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")) throw new ApiError(400, "invalid_request", "Form encoding is required.");
    const params = new URLSearchParams(text);
    for (const key of params.keys()) if (params.getAll(key).length !== 1) throw new ApiError(400, "invalid_request", "Repeated parameters are not allowed.");
    return Object.fromEntries(params);
  }
  return JSON.parse(text) as unknown;
}
export async function oauthGET(request: Request, action: string) {
  try {
    const origin = mcpOrigin();
    if (action !== "authorize") return Response.json({ error: "invalid_request" }, { status: 404, headers: noStore });
    const url = new URL(request.url); const params = url.searchParams;
    for (const key of params.keys()) if (params.getAll(key).length !== 1) throw new ApiError(400, "invalid_request", "Repeated parameters are not allowed.");
    const input = z.object({ client_id: z.uuid(), redirect_uri: z.string().max(2048), response_type: z.literal("code"),
      code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/), code_challenge_method: z.literal("S256"),
      resource: z.literal(mcpResource()), scope: z.string().max(500).optional(), state: z.string().max(2048).optional() }).parse(Object.fromEntries(params));
    const client = await getOAuthClient(input.client_id);
    if (!client || !client.redirect_uris.includes(input.redirect_uri)) throw new ApiError(400, "invalid_request", "The callback does not match this registered application.");
    let admin;
    try { admin = await requireAdminRequest(request); }
    catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.code === "MFA_REQUIRED")) {
        const login = new URL("/admin/login", origin); login.searchParams.set("next", `/api/mcp/oauth/authorize${url.search}`);
        if (error.code === "MFA_REQUIRED") login.searchParams.set("error", "mfa_required");
        return NextResponse.redirect(login);
      }
      throw error;
    }
    await assertRecentAuthentication(admin);
    await assertActionRateLimit(admin.userId, "mcp-consent", 10, 60);
    const nonce = secret(); const id = crypto.randomUUID();
    await saveOAuthConsent({ id, client_id: client.client_id, admin_user_id: admin.userId, redirect_uri: input.redirect_uri,
      resource: input.resource, scopes: parseScopes(input.scope), state: input.state ?? "", challenge: input.code_challenge,
      csrf_sha256: tokenHash(nonce), expires_at: new Date(Date.now() + 600000).toISOString(), consumed_at: null });
    const response = NextResponse.redirect(new URL(`/admin/mcp/connect?id=${id}`, origin));
    response.cookies.set(CONSENT_COOKIE, nonce, { httpOnly: true, secure: origin.startsWith("https:"), sameSite: "strict", path: "/", maxAge: 600 });
    response.headers.set("cache-control", "no-store"); return response;
  } catch (error) { return oauthError(error); }
}
export async function oauthPOST(request: Request, action: string) {
  try {
    const origin = mcpOrigin();
    if (["register", "token", "revoke"].includes(action)) {
      const source = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
      await assertActionRateLimit(tokenHash(source), `mcp-oauth-${action}`, action === "register" ? 20 : 120, action === "register" ? 3600 : 60);
    }
    if (action === "register") {
      const input = z.object({ client_name: z.string().trim().min(1).max(100).default("Connected assistant"), redirect_uris: z.array(z.string().max(2048)).min(1).max(5),
        token_endpoint_auth_method: z.literal("none").default("none"), grant_types: z.array(z.enum(["authorization_code", "refresh_token"])).optional(),
        response_types: z.array(z.literal("code")).optional() }).parse(await smallBody(request));
      const client = { client_id: crypto.randomUUID(), client_name: input.client_name, redirect_uris: [...new Set(input.redirect_uris.map(safeRedirect))] };
      await saveOAuthClient(client);
      return Response.json({ ...client, client_id_issued_at: Math.floor(Date.now()/1000), token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }, { status: 201, headers: noStore });
    }
    if (action === "authorize") {
      assertSameOrigin(request); const admin = await requireAdminRequest(request); await assertRecentAuthentication(admin);
      const input = z.object({ requestId: z.uuid(), decision: z.enum(["allow", "deny"]), scopes: z.array(z.enum(mcpScopes)).max(6) }).strict().parse(await smallBody(request));
      const nonce = readCookieValue(request, CONSENT_COOKIE); if (!nonce) throw new ApiError(400, "INVALID_CONSENT", "Start the connection again.");
      const code = secret();
      const consent = await finishOAuthConsent({ id: input.requestId, csrfHash: tokenHash(nonce), admin,
        scopes: [...new Set(input.scopes)], denied: input.decision === "deny", grantId: crypto.randomUUID(), codeHash: tokenHash(code) });
      const callback = new URL(consent.redirect_uri); if (consent.state) callback.searchParams.set("state", consent.state);
      callback.searchParams.set(input.decision === "allow" ? "code" : "error", input.decision === "allow" ? code : "access_denied");
      const response = NextResponse.json({ redirectUri: callback.toString() }, { headers: noStore });
      response.cookies.set(CONSENT_COOKIE, "", { path: "/", maxAge: 0, httpOnly: true, sameSite: "strict", secure: origin.startsWith("https:") });
      return response;
    }
    if (action === "token") {
      const input = z.object({ grant_type: z.enum(["authorization_code", "refresh_token"]), client_id: z.uuid(), resource: z.literal(mcpResource()),
        code: z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional(), redirect_uri: z.string().max(2048).optional(),
        code_verifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/).optional(), refresh_token: z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional() }).parse(await smallBody(request, true));
      if (input.grant_type === "authorization_code" && (!input.code || !input.redirect_uri || !input.code_verifier)
        || input.grant_type === "refresh_token" && !input.refresh_token) throw new ApiError(400, "invalid_request", "Missing grant parameters.");
      const access = secret(); const refresh = secret();
      const grant = await exchangeOAuthToken({ kind: input.grant_type, clientId: input.client_id, resource: input.resource,
        codeHash: tokenHash(input.code ?? ""), challenge: createHash("sha256").update(input.code_verifier ?? "").digest("base64url"), redirectUri: input.redirect_uri ?? "",
        refreshHash: tokenHash(input.refresh_token ?? ""), accessHash: tokenHash(access), nextRefreshHash: tokenHash(refresh) });
      if (!grant) throw new ApiError(400, "invalid_grant", "Authorization is invalid, expired or already used.");
      await verifyConnectedAdmin(grant.admin_user_id);
      if (process.env.NEXT_PUBLIC_ADMIN_MFA_REQUIRED === "true" && grant.assurance_level !== "aal2") throw new ApiError(400, "invalid_grant", "Sign in again with multi-factor verification.");
      return Response.json({ access_token: access, token_type: "Bearer", expires_in: Math.max(0, Math.min(900, Math.floor((Date.parse(grant.expires_at)-Date.now())/1000))),
        refresh_token: refresh, scope: grant.scopes.join(" ") }, { headers: noStore });
    }
    if (action === "revoke") {
      const input = z.object({ token: z.string().max(256), client_id: z.uuid() }).parse(await smallBody(request, true));
      const record = await lookupOAuthToken(tokenHash(input.token));
      if (record && record.grant.client_id === input.client_id) await revokeOAuthGrant(record.grant.id, record.grant.admin_user_id);
      return new Response(null, { status: 200, headers: noStore });
    }
    return Response.json({ error: "invalid_request" }, { status: 404, headers: noStore });
  } catch (error) { return oauthError(error); }
}
export function oauthError(error: unknown) {
  return Response.json({ error: error instanceof ApiError ? error.code : "invalid_request",
    error_description: error instanceof ApiError ? error.message : "The authorization request is invalid." }, {
    status: error instanceof ApiError ? error.status : 400, headers: noStore });
}
