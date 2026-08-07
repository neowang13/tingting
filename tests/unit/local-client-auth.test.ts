import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createLocalClientSession,
  verifyLocalClientCredentials,
  verifyLocalClientSession
} from "@/lib/local-client-auth";

const saved = { ...process.env };

beforeEach(() => {
  process.env.LOCAL_CLIENT_EMAIL = "client@example.test";
  process.env.LOCAL_CLIENT_PASSWORD_HASH = "scrypt:16384:8:1:yOFFQBMzNECrjrDUOOaNng:jrH2McTmfq8CsHuLWbUXUNkR_5-apU4s1_M0aT_KvjR6F42rsZJAhS86u-xolEfa7j9azZqaf7LagPaa6Jbr1A";
  process.env.LOCAL_CLIENT_SESSION_SECRET = "FFugT8wlbSjnkG4c5PDb0exVO-N3Yc-DvfsttbRQC0aZrlC-aHBWtwEjvOxhiw8e";
  process.env.LOCAL_CLIENT_DISPLAY_NAME = "Demo Applicant";
});

afterEach(() => {
  process.env = { ...saved };
});

describe("local client authentication", () => {
  it("validates credentials without sharing the admin cookie", async () => {
    expect(await verifyLocalClientCredentials("client@example.test", "test-admin-password")).toBe(true);
    expect(await verifyLocalClientCredentials("client@example.test", "wrong-password")).toBe(false);
  });

  it("signs, expires, and rejects tampered client sessions", () => {
    const issuedAt = Date.parse("2026-07-31T12:00:00Z");
    const token = createLocalClientSession("client@example.test", issuedAt);
    expect(verifyLocalClientSession(token, issuedAt + 30_000)?.displayName).toBe("Demo Applicant");
    expect(verifyLocalClientSession(`${token}tampered`, issuedAt + 30_000)).toBeNull();
    expect(verifyLocalClientSession(token, issuedAt + 61 * 60_000)).toBeNull();
  });
});
