import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => ({ rpc: mocks.rpc })) }));

import { assertActionRateLimit } from "@/lib/rate-limit";

describe("persistent action rate limits", () => {
  beforeEach(() => {
    vi.stubEnv("DATA_BACKEND", "supabase");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key");
    mocks.rpc.mockReset();
    mocks.rpc.mockResolvedValue({ data: true, error: null });
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each([900, 3600, 86400])("passes a valid PostgreSQL interval for a %s-second window", async (seconds) => {
    await assertActionRateLimit("test-user", "client-application-applicant-invite", 8, seconds);
    expect(mocks.rpc).toHaveBeenCalledWith("consume_action_rate_limit", {
      p_actor_key: "test-user", p_action_key: "client-application-applicant-invite",
      p_limit: 8, p_window: `${seconds} seconds`
    });
  });

  it("preserves a genuine exceeded-limit response", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    await expect(assertActionRateLimit("test-user", "invite", 8, 3600))
      .rejects.toMatchObject({ status: 429, code: "RATE_LIMITED" });
  });

  it("fails closed when the database check fails", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "08006" } });
    await expect(assertActionRateLimit("test-user", "invite", 8, 3600))
      .rejects.toMatchObject({ status: 503, code: "RATE_LIMIT_UNAVAILABLE" });
  });
});
