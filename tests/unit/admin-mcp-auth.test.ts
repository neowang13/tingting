import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), profile: vi.fn(), user: vi.fn(), lookup: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({
  rpc: mocks.rpc,
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.profile }) }) }),
  auth: { admin: { getUserById: mocks.user } }
}) }));
vi.mock("@/features/mcp/oauth-store", () => ({ lookupOAuthToken: mocks.lookup }));
import { authenticateMcp } from "@/features/mcp/auth";

const token = "x".repeat(43);
const actor = "00000000-0000-4000-8000-000000000001";
const request = () => new Request("https://silverkey.ca/api/mcp", { headers: { authorization: `Bearer ${token}` } });
beforeEach(() => {
  vi.stubEnv("MCP_ENABLED", "true"); vi.stubEnv("DATA_BACKEND", "supabase"); vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("APP_BASE_URL", "https://silverkey.ca"); vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-only-not-a-real-key");
  vi.stubEnv("NEXT_PUBLIC_ADMIN_MFA_REQUIRED", "false");
  mocks.lookup.mockResolvedValue({ token: { kind: "access", expires_at: "2099-01-01T00:00:00Z" }, grant: {
    id: "00000000-0000-4000-8000-000000000050", admin_user_id: actor, resource: "https://silverkey.ca/api/mcp",
    scopes: ["rentals:read"], assurance_level: "aal1", authenticated_at: new Date().toISOString(),
    expires_at: "2099-01-01T00:00:00Z", revoked_at: null
  } });
  mocks.rpc.mockResolvedValue({ data: true, error: null });
  mocks.profile.mockResolvedValue({ data: { is_active: true, display_name: "Owner" }, error: null });
  mocks.user.mockResolvedValue({ data: { user: { id: actor, email: "owner@example.test" } }, error: null });
});
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });
it("verifies the bound administrator on each request without claiming MFA assurance", async () => {
  const principal = await authenticateMcp(request());
  expect(principal.admin).toMatchObject({ userId: actor, assuranceLevel: "aal1" });
  expect(mocks.user).toHaveBeenCalledWith(actor);
  mocks.profile.mockResolvedValue({ data: { is_active: false }, error: null });
  await expect(authenticateMcp(request())).rejects.toMatchObject({ code: "MCP_ADMIN_INACTIVE" });
});
it("rejects banned and deleted Auth users even with an active admin profile", async () => {
  mocks.user.mockResolvedValue({ data: { user: { id: actor, banned_until: "2099-01-01T00:00:00Z" } }, error: null });
  await expect(authenticateMcp(request())).rejects.toMatchObject({ code: "MCP_ADMIN_INACTIVE" });
  mocks.user.mockResolvedValue({ data: { user: null }, error: null });
  await expect(authenticateMcp(request())).rejects.toMatchObject({ code: "MCP_ADMIN_INACTIVE" });
});
it("fails closed when administrator verification or durable rate limiting is unavailable", async () => {
  mocks.profile.mockResolvedValue({ data: null, error: { message: "unavailable" } });
  await expect(authenticateMcp(request())).rejects.toMatchObject({ code: "MCP_UNAVAILABLE" });
  mocks.rpc.mockResolvedValue({ data: null, error: { message: "unavailable" } });
  await expect(authenticateMcp(request())).rejects.toMatchObject({ code: "RATE_LIMIT_UNAVAILABLE" });
});
