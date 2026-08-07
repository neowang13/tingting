import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ createServerClient: vi.fn() }));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.createServerClient }));

import { proxy } from "../../proxy";

const originalEnvironment = { ...process.env };
const expiredCookies = "tt-client-last-active=1; tt-client-session-started=1; tt-client-session=session";

describe("Client proxy session-expiry return paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnvironment };
  });

  it("preserves an apply page and query after a local Client session expires", async () => {
    process.env.DATA_BACKEND = "memory";
    const response = await proxy(new NextRequest(
      "https://tingting.example/client/apply/howe-street-one-bedroom?source=listing",
      { headers: { cookie: expiredCookies } }
    ));

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/client/login");
    expect(location.searchParams.get("error")).toBe("session_expired");
    expect(location.searchParams.get("next")).toBe("/client/apply/howe-street-one-bedroom?source=listing");
  });

  it("preserves a specific application after a Supabase Client session expires", async () => {
    process.env.DATA_BACKEND = "supabase";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-test";
    const signOut = vi.fn().mockResolvedValue({ error: null });
    mocks.createServerClient.mockReturnValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }), signOut }
    });

    const response = await proxy(new NextRequest(
      "https://tingting.example/client/applications/00000000-0000-4000-8000-000000000009?step=4",
      { headers: { cookie: expiredCookies } }
    ));

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.searchParams.get("next"))
      .toBe("/client/applications/00000000-0000-4000-8000-000000000009?step=4");
    expect(signOut).toHaveBeenCalledOnce();
  });
});
