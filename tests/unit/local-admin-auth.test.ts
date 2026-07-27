import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createLocalAdminSession,
  verifyLocalAdminCredentials,
  verifyLocalAdminSession
} from "../../src/lib/local-admin-auth";

const originalEnvironment = { ...process.env };

describe("local administrator authentication", () => {
  beforeEach(() => {
    process.env.LOCAL_ADMIN_EMAIL = "admin@example.test";
    process.env.LOCAL_ADMIN_PASSWORD_HASH =
      "scrypt:16384:8:1:yOFFQBMzNECrjrDUOOaNng:jrH2McTmfq8CsHuLWbUXUNkR_5-apU4s1_M0aT_KvjR6F42rsZJAhS86u-xolEfa7j9azZqaf7LagPaa6Jbr1A";
    process.env.LOCAL_ADMIN_SESSION_SECRET =
      "test-session-secret-that-is-long-enough-for-signing";
    process.env.LOCAL_ADMIN_DISPLAY_NAME = "Test Admin";
  });

  afterEach(() => {
    process.env = { ...originalEnvironment };
  });

  it("accepts only the configured email and password", async () => {
    await expect(
      verifyLocalAdminCredentials("ADMIN@example.test", "test-admin-password")
    ).resolves.toBe(true);
    await expect(
      verifyLocalAdminCredentials("other@example.test", "test-admin-password")
    ).resolves.toBe(false);
    await expect(
      verifyLocalAdminCredentials("admin@example.test", "wrong-password")
    ).resolves.toBe(false);
  });

  it("signs, verifies, rejects tampering, and expires sessions", () => {
    const now = Date.UTC(2026, 6, 26, 12);
    const token = createLocalAdminSession("admin@example.test", now);

    expect(verifyLocalAdminSession(token, now + 1_000)).toMatchObject({
      email: "admin@example.test",
      displayName: "Test Admin",
      assuranceLevel: "aal2"
    });
    expect(verifyLocalAdminSession(`${token}tampered`, now + 1_000)).toBeNull();
    expect(verifyLocalAdminSession(token, now + 13 * 60 * 60_000)).toBeNull();
  });
});
