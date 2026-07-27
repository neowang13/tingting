import { describe, expect, it } from "vitest";
import {
  assertConfirmationExecutable,
  createConfirmationDigest
} from "@/features/automation/confirmations";
import type { AutomationConfirmationIntent } from "@/features/automation/contracts";

function intent(overrides: Partial<AutomationConfirmationIntent> = {}): AutomationConfirmationIntent {
  const base = {
    id: crypto.randomUUID(),
    serviceAccountId: crypto.randomUUID(),
    action: "rental.publish" as const,
    targetType: "rental_listing",
    targetId: crypto.randomUUID(),
    targetVersion: new Date().toISOString(),
    payload: { action: "publish" },
    summary: { title: "Publish", effects: ["Public"], warnings: [] },
    requiredAcknowledgements: ["public_visibility"],
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    consumedAt: null,
    createdAt: new Date().toISOString()
  };
  const digest = createConfirmationDigest({
    serviceAccountId: base.serviceAccountId,
    action: base.action,
    targetType: base.targetType,
    targetId: base.targetId,
    targetVersion: base.targetVersion,
    payload: base.payload,
    expiresAt: base.expiresAt
  });
  return { ...base, digest, ...overrides };
}

describe("automation confirmation", () => {
  it("binds ownership, digest, acknowledgement, expiry, and single use", () => {
    const value = intent();
    expect(() => assertConfirmationExecutable(
      value,
      value.serviceAccountId,
      value.digest,
      ["public_visibility"]
    )).not.toThrow();
    expect(() => assertConfirmationExecutable(value, crypto.randomUUID(), value.digest, ["public_visibility"])).toThrow();
    expect(() => assertConfirmationExecutable(value, value.serviceAccountId, "sha256:".padEnd(71, "0"), ["public_visibility"])).toThrow();
    expect(() => assertConfirmationExecutable(value, value.serviceAccountId, value.digest, [])).toThrow();
    expect(() => assertConfirmationExecutable(intent({ expiresAt: new Date(0).toISOString() }), value.serviceAccountId, value.digest, ["public_visibility"])).toThrow();
    expect(() => assertConfirmationExecutable(intent({ consumedAt: new Date().toISOString() }), value.serviceAccountId, value.digest, ["public_visibility"])).toThrow();
  });
});

