import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/lib/api";

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  createClient: vi.fn(),
  cookies: vi.fn(),
  listMediaAssets: vi.fn()
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: mocks.createServerClient
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: mocks.createClient
}));

vi.mock("next/headers", () => ({
  cookies: mocks.cookies
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((location: string) => {
    throw new Error(`redirect:${location}`);
  })
}));

vi.mock("../../src/features/content/media-service", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/features/content/media-service")>();
  return {
    ...original,
    listMediaAssets: mocks.listMediaAssets
  };
});

import {
  assertRecentAuthentication,
  assertSameOrigin,
  requireAdminRequest
} from "../../src/lib/auth";
import { GET as getMedia } from "../../src/app/api/admin/media/route";

const originalEnvironment = { ...process.env };
const nowSeconds = Math.floor(Date.now() / 1000);

function queryResult(data: unknown) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({ data, error: null })
      })
    })
  };
}

function configureSupabaseSession(options: {
  user?: { id: string; email: string } | null;
  profile?: { display_name: string; is_active: boolean } | null;
  aal?: "aal1" | "aal2";
  issuedAt?: number;
  expiresAt?: number;
  authenticationAt?: number;
} = {}) {
  const user = options.user === undefined
    ? { id: "00000000-0000-4000-8000-000000000001", email: "admin@example.test" }
    : options.user;
  const cookieClient = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user },
        error: user ? null : new Error("missing session")
      }),
      getClaims: vi.fn().mockResolvedValue({
        data: user
          ? {
              claims: {
                aal: options.aal ?? "aal2",
                iat: options.issuedAt ?? nowSeconds - 60,
                exp: options.expiresAt ?? nowSeconds + 3600,
                amr: [
                  {
                    method: options.aal === "aal1" ? "password" : "totp",
                    timestamp: options.authenticationAt ?? nowSeconds - 60
                  }
                ]
              }
            }
          : null,
        error: user ? null : new Error("missing session")
      })
    }
  };
  const serviceClient = {
    from: vi.fn().mockReturnValue(
      queryResult(options.profile === undefined
        ? { display_name: "Test Admin", is_active: true }
        : options.profile)
    )
  };
  mocks.createServerClient.mockReturnValue(cookieClient);
  mocks.createClient.mockReturnValue(serviceClient);
  return { cookieClient, serviceClient };
}

function adminRequest(
  path = "/api/admin/dashboard",
  init: RequestInit = {},
  tracking: { lastActive?: number; sessionStarted?: number } = {}
) {
  const lastActive = tracking.lastActive ?? Date.now() - 5_000;
  const sessionStarted = tracking.sessionStarted ?? Date.now() - 60_000;
  return new Request(`https://admin.example.test${path}`, {
    ...init,
    headers: {
      cookie: `tt-last-active=${lastActive}; tt-session-started=${sessionStarted}; sb-test-auth-token=cookie-session`,
      ...init.headers
    }
  });
}

describe("Supabase administrator API authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATA_BACKEND = "supabase";
    process.env.NEXT_PUBLIC_APP_MODE = "production";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
    mocks.cookies.mockResolvedValue({
      getAll: () => [{ name: "sb-test-auth-token", value: "cookie-session" }],
      set: vi.fn(),
      get: vi.fn(),
      delete: vi.fn()
    });
  });

  afterEach(() => {
    process.env = { ...originalEnvironment };
  });

  it("accepts a valid Supabase SSR Cookie Session without a Bearer token", async () => {
    const { cookieClient } = configureSupabaseSession();

    await expect(requireAdminRequest(adminRequest())).resolves.toMatchObject({
      email: "admin@example.test",
      assuranceLevel: "aal2",
      displayName: "Test Admin"
    });
    expect(cookieClient.auth.getUser).toHaveBeenCalledWith();
    expect(mocks.createServerClient).toHaveBeenCalledWith(
      "https://project.supabase.co",
      "anon-test",
      expect.objectContaining({ cookies: expect.any(Object) })
    );
  });

  it("only allows an untracked Cookie Session during server-side session establishment", async () => {
    configureSupabaseSession();
    const untracked = new Request("https://admin.example.test/api/auth/session", {
      method: "POST",
      headers: {
        cookie: "sb-test-auth-token=cookie-session",
        origin: "https://admin.example.test",
        "sec-fetch-site": "same-origin"
      }
    });

    await expect(requireAdminRequest(untracked)).rejects.toMatchObject({
      status: 401,
      code: "SESSION_EXPIRED"
    });
    await expect(
      requireAdminRequest(untracked, { allowUntrackedSession: true })
    ).resolves.toMatchObject({ assuranceLevel: "aal2" });
  });

  it("returns 401 when the Cookie Session is missing", async () => {
    configureSupabaseSession({ user: null });

    await expect(requireAdminRequest(adminRequest())).rejects.toMatchObject({
      status: 401,
      code: "UNAUTHORIZED"
    });
  });

  it("returns 403 when the administrator profile is inactive", async () => {
    configureSupabaseSession({ profile: { display_name: "Disabled", is_active: false } });

    await expect(requireAdminRequest(adminRequest())).rejects.toMatchObject({
      status: 403,
      code: "FORBIDDEN"
    });
  });

  it("requires AAL2 in production and accepts AAL2 for ordinary writes", async () => {
    configureSupabaseSession({ aal: "aal1" });
    await expect(requireAdminRequest(adminRequest())).rejects.toMatchObject({
      status: 403,
      code: "MFA_REQUIRED"
    });

    configureSupabaseSession({ aal: "aal2" });
    const request = adminRequest("/api/admin/tenants/tenant-1", {
      method: "PATCH",
      headers: {
        origin: "https://admin.example.test",
        "sec-fetch-site": "same-origin"
      }
    });
    expect(() => assertSameOrigin(request)).not.toThrow();
    await expect(requireAdminRequest(request)).resolves.toMatchObject({ assuranceLevel: "aal2" });
  });

  it("rejects expired sessions and stale recent authentication", async () => {
    configureSupabaseSession();
    await expect(
      requireAdminRequest(
        adminRequest("/api/admin/dashboard", {}, { lastActive: Date.now() - 31 * 60_000 })
      )
    ).rejects.toMatchObject({ status: 401, code: "SESSION_EXPIRED" });

    await expect(
      assertRecentAuthentication({
        userId: "admin",
        email: "a***@example.test",
        displayName: "Admin",
        assuranceLevel: "aal2",
        authenticatedAt: new Date(Date.now() - 11 * 60_000).toISOString()
      })
    ).rejects.toThrowError(ApiError);
  });

  it("rejects cross-site and origin-less production writes", () => {
    expect(() =>
      assertSameOrigin(adminRequest("/api/admin/tenants", {
        method: "POST",
        headers: {
          origin: "https://attacker.example",
          "sec-fetch-site": "cross-site"
        }
      }))
    ).toThrowError(expect.objectContaining({ code: "CROSS_SITE_REQUEST_BLOCKED" }));

    expect(() =>
      assertSameOrigin(adminRequest("/api/admin/tenants", { method: "POST" }))
    ).toThrowError(expect.objectContaining({ code: "ORIGIN_REQUIRED" }));

    expect(() =>
      assertSameOrigin(adminRequest("/api/admin/tenants", {
        method: "POST",
        headers: {
          origin: "https://attacker.example",
          "sec-fetch-site": "same-origin",
          "x-forwarded-host": "attacker.example",
          "x-forwarded-proto": "https"
        }
      }))
    ).toThrowError(expect.objectContaining({ code: "ORIGIN_MISMATCH" }));
  });

  it("protects the Media API with the same Cookie Session boundary", async () => {
    configureSupabaseSession({ user: null });
    const unauthorized = await getMedia(adminRequest("/api/admin/media"));
    expect(unauthorized.status).toBe(401);

    configureSupabaseSession();
    mocks.listMediaAssets.mockResolvedValue([]);
    const authorized = await getMedia(adminRequest("/api/admin/media"));
    expect(authorized.status).toBe(200);
    expect(mocks.listMediaAssets).toHaveBeenCalledOnce();
  });
});
