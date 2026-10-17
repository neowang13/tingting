import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { oauthGET, oauthPOST, authorizationMetadata, protectedMetadata, CONSENT_COOKIE } from "@/features/mcp/oauth-http";
import { authenticateMcp } from "@/features/mcp/auth";
import { POST as mcpPOST } from "@/app/api/mcp/route";
import { DELETE as revokeConnection } from "@/app/api/admin/mcp/connections/route";
import { createLocalAdminSession, LOCAL_ADMIN_SESSION_COOKIE } from "@/lib/local-admin-auth";
import { adminLoginDestination } from "@/lib/admin-login-destination";
import type { NextResponse } from "next/server";
import { auth as sdkAuth, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformationMixed, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";

const origin = "http://localhost:3000";
const resource = `${origin}/api/mcp`;
const callback = "https://muse-client.example/callback";
const verifier = "p".repeat(43);
const state = "state-not-shared-with-other-clients";
let adminCookie: string;
function jsonRequest(body: unknown, cookie = "", requestOrigin = origin) {
  return new Request(`${origin}/api/mcp/oauth/authorize`, { method: "POST", headers: { "content-type": "application/json", origin: requestOrigin, cookie }, body: JSON.stringify(body) });
}
function tokenRequest(body: Record<string,string>) {
  return new Request(`${origin}/api/mcp/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body).toString() });
}
async function registered() {
  const response = await oauthPOST(jsonRequest({ client_name: "My Muse", redirect_uris: [callback], token_endpoint_auth_method: "none" }), "register");
  expect(response.status).toBe(201); return (await response.json()).client_id as string;
}
function authorizationUrl(clientId: string, overrides: Record<string,string> = {}) {
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: callback, response_type: "code", resource,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256",
    scope: "rentals:read rentals:write", state, ...overrides });
  return `${origin}/api/mcp/oauth/authorize?${params}`;
}
async function pending(clientId: string) {
  const response = await oauthGET(new Request(authorizationUrl(clientId), { headers: { cookie: adminCookie } }), "authorize") as NextResponse;
  expect(response.status).toBe(307);
  const id = new URL(response.headers.get("location")!).searchParams.get("id")!;
  const cookie = `${adminCookie}; ${CONSENT_COOKIE}=${response.cookies.get(CONSENT_COOKIE)!.value}`;
  return { id, cookie };
}
async function approved(clientId: string) {
  const consent = await pending(clientId);
  const response = await oauthPOST(jsonRequest({ requestId: consent.id, decision: "allow", scopes: ["rentals:read", "rentals:write"] }, consent.cookie), "authorize");
  expect(response.status).toBe(200);
  const result = new URL((await response.json()).redirectUri);
  expect(result.searchParams.get("state")).toBe(state);
  return result.searchParams.get("code")!;
}
function exchange(clientId: string, code: string, overrides: Record<string,string> = {}) {
  return oauthPOST(tokenRequest({ grant_type: "authorization_code", client_id: clientId, code, code_verifier: verifier, redirect_uri: callback, resource, ...overrides }), "token");
}
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("DATA_BACKEND", "memory"); vi.stubEnv("NEXT_PUBLIC_APP_MODE", "demo");
  vi.stubEnv("MCP_ENABLED", "true"); vi.stubEnv("APP_BASE_URL", origin); vi.stubEnv("NEXT_PUBLIC_ADMIN_MFA_REQUIRED", "false");
  vi.stubEnv("LOCAL_ADMIN_EMAIL", "admin@example.test"); vi.stubEnv("LOCAL_ADMIN_PASSWORD_HASH", "test-placeholder-not-used-for-cookie-verification");
  vi.stubEnv("LOCAL_ADMIN_SESSION_SECRET", "s".repeat(64));
  globalThis.__tingtingMcpOAuth = undefined; globalThis.__tingtingActionRateLimits = new Map();
  adminCookie = `${LOCAL_ADMIN_SESSION_COOKIE}=${createLocalAdminSession("admin@example.test")}`;
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("Admin-only OAuth connection", () => {
  it("interoperates with official SDK OAuth discovery, dynamic registration, PKCE and token exchange", async () => {
    let clientInfo: OAuthClientInformationMixed | undefined; let tokens: OAuthTokens | undefined;
    let codeVerifier = ""; let authorizationUrl: URL | undefined;
    const provider: OAuthClientProvider = {
      redirectUrl: callback, clientMetadata: { client_name: "SDK Muse", redirect_uris: [callback], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] },
      clientInformation: () => clientInfo, saveClientInformation: info => { clientInfo = info; }, tokens: () => tokens,
      saveTokens: value => { tokens = value; }, saveCodeVerifier: value => { codeVerifier = value; }, codeVerifier: () => codeVerifier,
      redirectToAuthorization: url => { authorizationUrl = url; }
    };
    const fetchFn: typeof fetch = async (input, init) => {
      const req = new Request(input, init); const path = new URL(req.url).pathname;
      if (path.includes("oauth-protected-resource")) return Response.json(protectedMetadata());
      if (path.includes("oauth-authorization-server")) return Response.json(authorizationMetadata());
      return req.method === "POST" ? oauthPOST(req, path.split("/").at(-1)!) : oauthGET(req, path.split("/").at(-1)!);
    };
    expect(await sdkAuth(provider, { serverUrl: resource, scope: "rentals:read rentals:write", fetchFn })).toBe("REDIRECT");
    expect(authorizationUrl).toBeDefined();
    const pendingResponse = await oauthGET(new Request(authorizationUrl!, { headers: { cookie: adminCookie } }), "authorize") as NextResponse;
    expect(pendingResponse.status).toBe(307);
    const id = new URL(pendingResponse.headers.get("location")!).searchParams.get("id")!;
    const cookie = `${adminCookie}; ${CONSENT_COOKIE}=${pendingResponse.cookies.get(CONSENT_COOKIE)!.value}`;
    const consent = await oauthPOST(jsonRequest({ requestId: id, decision: "allow", scopes: ["rentals:read", "rentals:write"] }, cookie), "authorize");
    const code = new URL((await consent.json()).redirectUri).searchParams.get("code")!;
    expect(await sdkAuth(provider, { serverUrl: resource, authorizationCode: code, fetchFn })).toBe("AUTHORIZED");
    expect(tokens?.access_token).toBeTruthy();
    const identity = await authenticateMcp(new Request(resource, { headers: { authorization: `Bearer ${tokens!.access_token}` } }));
    expect(identity.scopes).toEqual(["rentals:read", "rentals:write"]);
    expect(await sdkAuth(provider, { serverUrl: resource, scope: "rentals:read rentals:write", fetchFn })).toBe("AUTHORIZED");
  });
  it("advertises discovery and requires existing Admin login, not a Muse or Client account", async () => {
    expect(authorizationMetadata()).toMatchObject({ code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"] });
    expect(protectedMetadata().resource).toBe(resource);
    const clientId = await registered();
    const anonymous = await oauthGET(new Request(authorizationUrl(clientId)), "authorize");
    expect(new URL(anonymous.headers.get("location")!).pathname).toBe("/admin/login");
    const customer = await oauthGET(new Request(authorizationUrl(clientId), { headers: { cookie: "tt-client-session=ordinary-client-session" } }), "authorize");
    expect(new URL(customer.headers.get("location")!).pathname).toBe("/admin/login");
    expect(globalThis.__tingtingMcpOAuth!.grants.size).toBe(0);
    const unauthorized = await mcpPOST(new Request(resource));
    expect(unauthorized.status).toBe(401); expect(unauthorized.headers.get("www-authenticate")).toContain("oauth-protected-resource/api/mcp");
    expect((await exchange(clientId, "x".repeat(43))).status).toBe(400);
  });
  it("binds consent to the Admin session, browser nonce, exact redirect, scopes and PKCE", async () => {
    const clientId = await registered();
    expect((await oauthGET(new Request(authorizationUrl(clientId, { redirect_uri: "https://attacker.example/callback" }), { headers: { cookie: adminCookie } }), "authorize")).status).toBe(400);
    expect((await oauthGET(new Request(authorizationUrl(clientId, { code_challenge_method: "plain" }), { headers: { cookie: adminCookie } }), "authorize")).status).toBe(400);
    const consent = await pending(clientId); const body = { requestId: consent.id, decision: "allow", scopes: ["rentals:read", "rentals:write"] };
    expect((await oauthPOST(jsonRequest(body, consent.cookie, "https://attacker.example"), "authorize")).status).toBe(403);
    expect((await oauthPOST(jsonRequest(body, adminCookie), "authorize")).status).toBe(400);
    expect((await oauthPOST(jsonRequest({ ...body, scopes: ["applications:write"] }, consent.cookie), "authorize")).status).toBe(400);
    const approvedResponse = await oauthPOST(jsonRequest(body, consent.cookie), "authorize");
    const code = new URL((await approvedResponse.json()).redirectUri).searchParams.get("code")!;
    expect((await oauthPOST(jsonRequest(body, consent.cookie), "authorize")).status).toBe(400);
    expect((await exchange(clientId, code, { code_verifier: "q".repeat(43) })).status).toBe(400);
    expect((await exchange(clientId, code, { resource: `${origin}/api/admin` })).status).toBe(400);
    const response = await exchange(clientId, code); expect(response.status).toBe(200);
    const tokens = await response.json(); expect(tokens.expires_in).toBeLessThanOrEqual(900);
    const identity = await authenticateMcp(new Request(resource, { headers: { authorization: `Bearer ${tokens.access_token}` } }));
    expect(identity.admin.userId).toBe("00000000-0000-4000-8000-000000000001"); expect(identity.scopes).toEqual(["rentals:read", "rentals:write"]);
    expect(JSON.stringify([...globalThis.__tingtingMcpOAuth!.codes.values()])).not.toContain(code);
    expect(JSON.stringify([...globalThis.__tingtingMcpOAuth!.tokens.values()])).not.toContain(tokens.access_token);
  });
  it("rotates refresh tokens and revokes the connection when a consumed refresh is replayed", async () => {
    const id = await registered(); const first = await (await exchange(id, await approved(id))).json();
    const refreshRequest = () => tokenRequest({ grant_type: "refresh_token", client_id: id, refresh_token: first.refresh_token, resource });
    const response = await oauthPOST(refreshRequest(), "token"); expect(response.status).toBe(200);
    const next = await response.json(); expect(next.refresh_token).not.toBe(first.refresh_token);
    expect((await oauthPOST(refreshRequest(), "token")).status).toBe(400);
    await expect(authenticateMcp(new Request(resource, { headers: { authorization: `Bearer ${next.access_token}` } }))).rejects.toMatchObject({ status: 401 });
  });
  it("denial issues no grant, and an Admin can revoke a previously authorized app", async () => {
    const id = await registered(); const consent = await pending(id);
    const denied = await oauthPOST(jsonRequest({ requestId: consent.id, decision: "deny", scopes: [] }, consent.cookie), "authorize");
    expect(new URL((await denied.json()).redirectUri).searchParams.get("error")).toBe("access_denied");
    expect(globalThis.__tingtingMcpOAuth!.grants.size).toBe(0);
    const tokens = await (await exchange(id, await approved(id))).json();
    const granted = [...globalThis.__tingtingMcpOAuth!.grants.values()][0];
    expect((await revokeConnection(new Request(`${origin}/api/admin/mcp/connections`, { method: "DELETE", headers: { origin, cookie: adminCookie, "content-type": "application/json" }, body: JSON.stringify({ id: granted.id }) }))).status).toBe(200);
    await expect(authenticateMcp(new Request(resource, { headers: { authorization: `Bearer ${tokens.access_token}` } }))).rejects.toMatchObject({ status: 401 });
  });
  it("rejects unsafe registration and prevents login return-path injection", async () => {
    const bad = await oauthPOST(jsonRequest({ client_name: "Bad", redirect_uris: ["http://attacker.example/callback"] }), "register");
    expect(bad.status).toBe(400);
    for (const path of ["https://attacker.example", "//attacker.example", "/\\attacker.example", "/api/admin/anything"]) expect(adminLoginDestination(path)).toBe("/admin");
    expect(adminLoginDestination("/api/mcp/oauth/authorize?state=valid")).toBe("/api/mcp/oauth/authorize?state=valid");
  });
});
