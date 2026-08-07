import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  createClient: vi.fn(),
  cookies: vi.fn()
}));

vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.createServerClient }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { requireClientRequest } from "@/lib/client-auth";
import { CLIENT_SUPABASE_COOKIE_NAME } from "@/lib/client-auth-config";

const originalEnvironment = { ...process.env };

function queryResult(data: unknown) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({ data, error: null })
      })
    })
  };
}

describe("Client and Admin authentication boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATA_BACKEND = "supabase";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
    mocks.cookies.mockResolvedValue({ getAll: vi.fn().mockReturnValue([]), set: vi.fn() });
  });

  afterEach(() => {
    process.env = { ...originalEnvironment };
  });

  it("rejects a Client session until its email is verified", async () => {
    mocks.createServerClient.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "client-1", email: "client@example.test", email_confirmed_at: null } },
          error: null
        })
      }
    });

    await expect(requireClientRequest(new Request("https://example.test/api/client/applications")))
      .rejects.toMatchObject({ status: 403, code: "EMAIL_VERIFICATION_REQUIRED" });
    expect(mocks.createServerClient).toHaveBeenCalledWith(
      "https://project.supabase.co",
      "anon-test",
      expect.objectContaining({ cookieOptions: { name: CLIENT_SUPABASE_COOKIE_NAME } })
    );
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("rejects an active Admin identity even if it also has a Client profile", async () => {
    mocks.createServerClient.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "dual-identity", email: "admin@example.test", email_confirmed_at: "2026-08-06T12:00:00Z" } },
          error: null
        })
      }
    });
    mocks.createClient.mockReturnValue({
      from: vi.fn((table: string) => queryResult(
        table === "client_profiles"
          ? { display_name: "Wrong Client", is_active: true }
          : { is_active: true }
      ))
    });

    await expect(requireClientRequest(new Request("https://example.test/api/client/applications")))
      .rejects.toMatchObject({ status: 403, code: "CLIENT_ADMIN_IDENTITY_CONFLICT" });
  });
});
