import { describe, expect, it } from "vitest";
import {
  constantTimeTokenMatch,
  generateAutomationToken,
  hashAutomationToken,
  parseAutomationToken,
  validateAutomationToken
} from "@/features/automation/auth";

const pepper = "a".repeat(48);

describe("automation service token", () => {
  it("generates an opaque show-once token and HMAC digest", () => {
    const generated = generateAutomationToken(pepper);
    expect(generated.token).toMatch(/^tta_[A-Za-z0-9_-]{8,20}_[A-Za-z0-9_-]{40,}$/);
    expect(generated.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(generated.tokenHash).not.toContain(generated.token);
    expect(constantTimeTokenMatch(
      hashAutomationToken(generated.token, pepper),
      generated.tokenHash
    )).toBe(true);
  });

  it("rejects inactive and expired identities", () => {
    const generated = generateAutomationToken(pepper);
    const parsed = parseAutomationToken(`Bearer ${generated.token}`);
    expect(parsed.prefix).toBe(generated.prefix);
    expect(() => validateAutomationToken(
      generated.token,
      {
        id: crypto.randomUUID(),
        prefix: generated.prefix,
        tokenHash: generated.tokenHash,
        isActive: true,
        expiresAt: new Date(Date.now() - 1_000).toISOString(),
        revokedAt: null,
        serviceAccount: {
          id: crypto.randomUUID(),
          name: "Test",
          delegatedAdminUserId: crypto.randomUUID(),
          delegatedAdminActive: true,
          scopes: ["rentals:read"],
          isActive: true,
          expiresAt: null
        }
      },
      pepper,
      crypto.randomUUID()
    )).toThrow(/inactive/i);
  });
});

