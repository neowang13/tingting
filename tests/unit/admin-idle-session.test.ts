import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { adminSessionTimes, ADMIN_IDLE_TIMEOUT_MS } from "@/lib/admin-session-policy";
import { proxy } from "../../proxy";

afterEach(() => { vi.unstubAllEnvs(); });
describe("administrator inactivity", () => {
  it("allows 59 minutes of inactivity, including a sign-in older than ten minutes", () => {
    const now = 2_000_000_000_000;
    expect(ADMIN_IDLE_TIMEOUT_MS).toBe(3_600_000);
    expect(adminSessionTimes(String(now - 59 * 60_000), String(now - 4 * 60 * 60_000), now).expired).toBe(false);
    expect(adminSessionTimes(String(now - 60 * 60_000), String(now - 4 * 60 * 60_000), now).expired).toBe(true);
  });
  it("rejects missing or future tracking instead of inventing fresh activity", () => {
    expect(adminSessionTimes(undefined, undefined).expired).toBe(true);
    expect(adminSessionTimes(String(Date.now() + 120_000), String(Date.now())).expired).toBe(true);
  });
  it("does not count background Admin requests as user activity", async () => {
    vi.stubEnv("DATA_BACKEND", "memory");
    const now = Date.now();
    const response = await proxy(new NextRequest("https://example.test/api/admin/applications", { headers: { cookie: `tt-last-active=${now - 59 * 60_000}; tt-session-started=${now - 2 * 60 * 60_000}` } }));
    expect(response.status).toBe(200);
    expect(response.cookies.get("tt-last-active")).toBeUndefined();
  });
  it("clears an expired API session and allows its login page without a redirect loop", async () => {
    vi.stubEnv("DATA_BACKEND", "memory");
    const cookie = `tt-last-active=${Date.now() - 60 * 60_000 - 1}; tt-session-started=${Date.now() - 2 * 60 * 60_000}; tt-admin-session=test`;
    const denied = await proxy(new NextRequest("https://example.test/api/admin/applications", { headers: { cookie } }));
    expect(denied.status).toBe(401);
    expect(denied.cookies.get("tt-admin-session")?.value).toBe("");
    const login = await proxy(new NextRequest("https://example.test/admin/login?error=session_expired", { headers: { cookie } }));
    expect(login.status).toBe(200);
    expect(login.headers.get("location")).toBeNull();
  });
});
