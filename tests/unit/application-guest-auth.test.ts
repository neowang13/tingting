import { describe, expect, it } from "vitest";
import {
  createGuestBearerToken,
  hashGuestToken,
  parseGuestSessionCookie,
  serializeGuestSessionCookie,
  readGuestCookie,
  applicationGuestSecret,
} from "@/lib/application-guest-auth";
import { hashApplicationRequestValue } from "@/features/applications/request-context";

describe("application guest authentication", () => {
  it("creates high-entropy bearer tokens and stores only deterministic hashes", () => {
    const first = createGuestBearerToken();
    const second = createGuestBearerToken();

    expect(first).not.toBe(second);
    expect(first.length).toBeGreaterThanOrEqual(43);
    expect(hashGuestToken(first)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashGuestToken(first)).toBe(hashGuestToken(first));
    expect(hashGuestToken(first)).not.toContain(first);
  });

  it("signs HttpOnly guest cookies and rejects tampering", () => {
    const secret = "test-secret-that-is-long-enough-for-hmac-signing";
    const token = createGuestBearerToken();
    const cookie = serializeGuestSessionCookie(token, secret, new Date("2026-08-27T00:00:00.000Z"));
    const value = /application_guest=([^;]+)/.exec(cookie)?.[1];

    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(parseGuestSessionCookie(value, secret)).toBe(token);
    expect(parseGuestSessionCookie(`${value}x`, secret)).toBeNull();
  });

  it("uses a secret-keyed, purpose-separated HMAC for request fingerprints", () => {
    process.env.APPLICATION_GUEST_SESSION_SECRET = "first-test-secret-that-is-at-least-32-bytes";
    const first = hashApplicationRequestValue("203.0.113.7", "ip");
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toBe(hashGuestToken("203.0.113.7"));
    expect(first).not.toBe(hashApplicationRequestValue("203.0.113.7", "user-agent"));

    process.env.APPLICATION_GUEST_SESSION_SECRET = "second-test-secret-that-is-at-least-32-bytes";
    expect(hashApplicationRequestValue("203.0.113.7", "ip")).not.toBe(first);
    delete process.env.APPLICATION_GUEST_SESSION_SECRET;
  });

  it("keeps each tab's signed cookie bound to its applicant even when B is opened last", () => {
    const a = "40000000-0000-4000-8000-000000000001";
    const b = "40000000-0000-4000-8000-000000000002";
    const secret = applicationGuestSecret();
    const expires = new Date(Date.now() + 60_000);
    const cookieA = serializeGuestSessionCookie("token-a", secret, expires, a).split(";")[0];
    const cookieB = serializeGuestSessionCookie("token-b", secret, expires, b).split(";")[0];
    const latest = serializeGuestSessionCookie("token-b", secret, expires).split(";")[0];
    const request = (applicantId: string, cookie = `${cookieA}; ${cookieB}; ${latest}`) => new Request("https://example.test/api/application-guests/files", {
      method: "POST", headers: { cookie, "x-application-applicant-id": applicantId }
    });
    expect(readGuestCookie(request(a))).toBe("token-a");
    expect(readGuestCookie(request(b))).toBe("token-b");
    // Cookie names alone are not a signed authorization boundary.
    expect(() => readGuestCookie(request(a, cookieB.replace(b, a)))).toThrow();
    expect(() => readGuestCookie(request(a, latest))).toThrow();
    expect(() => readGuestCookie(request("invalid"))).toThrow();
  });

  it("rejects stale unscoped reads and writes before they can select the latest application", () => {
    const cookie = serializeGuestSessionCookie("latest-b", applicationGuestSecret(), new Date(Date.now() + 60_000)).split(";")[0];
    for (const [path, method] of [["files", "GET"], ["files", "POST"], ["files/file-id", "DELETE"], ["draft", "PATCH"], ["sign", "POST"]]) {
      expect(() => readGuestCookie(new Request(`https://example.test/api/application-guests/${path}`, { method, headers: { cookie } }))).toThrowError(
        expect.objectContaining({ status: 409, code: "APPLICATION_GUEST_CONTEXT_REQUIRED" })
      );
    }
    // A bare entry can still bootstrap once; all later operations require context.
    expect(readGuestCookie(new Request("https://example.test/api/application-guests/session", { headers: { cookie } }))).toBe("latest-b");
  });
});
