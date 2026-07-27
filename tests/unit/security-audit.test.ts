import { beforeEach, describe, expect, it } from "vitest";
import {
  maskAuditEmail,
  securityFingerprint,
  writeSecurityAudit
} from "../../src/lib/security-audit";

describe("security audit safety", () => {
  beforeEach(() => {
    process.env.DATA_BACKEND = "memory";
    globalThis.__tingtingSecurityAudit = [];
  });

  it("stores only allow-listed metadata and never the raw account address", async () => {
    const email = "Owner.Person@example.test";
    await writeSecurityAudit({
      action: "auth.login_failed",
      targetType: "auth_attempt",
      metadata: {
        accountMasked: maskAuditEmail(email),
        accountFingerprint: securityFingerprint(email),
        reason: "invalid_credentials",
        password: "must-not-be-stored",
        accessToken: "must-not-be-stored"
      }
    });

    const event = globalThis.__tingtingSecurityAudit?.[0];
    expect(event?.metadata).toEqual({
      accountMasked: "o***@example.test",
      accountFingerprint: securityFingerprint(email),
      reason: "invalid_credentials"
    });
    expect(JSON.stringify(event)).not.toContain(email);
    expect(JSON.stringify(event)).not.toContain("must-not-be-stored");
  });

  it("normalizes account fingerprints without revealing the input", () => {
    const first = securityFingerprint(" OWNER@example.test ");
    expect(first).toBe(securityFingerprint("owner@example.test"));
    expect(first).not.toContain("owner");
  });
});
