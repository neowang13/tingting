import { describe, expect, it } from "vitest";
import {
  createGuestBearerToken,
  hashGuestToken,
  parseGuestSessionCookie,
  serializeGuestSessionCookie,
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
});
