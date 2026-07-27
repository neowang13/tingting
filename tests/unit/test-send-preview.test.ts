import { beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "../../src/lib/api";
import {
  createTestSendPreviewToken,
  verifyTestSendPreviewToken
} from "../../src/features/notifications/test-send-preview";

const claims = {
  actorId: "00000000-0000-4000-8000-000000000001",
  tenantId: "00000000-0000-4000-8000-000000000002",
  channel: "email" as const,
  templateId: "00000000-0000-4000-8000-000000000003",
  requestId: "00000000-0000-4000-8000-000000000004"
};

describe("test-send preview confirmation", () => {
  beforeEach(() => {
    process.env.TEST_SEND_PREVIEW_SIGNING_SECRET = "unit-test-signing-secret-with-sufficient-entropy";
  });

  it("accepts a current token bound to the administrator and exact preview", () => {
    const token = createTestSendPreviewToken(claims, 1_000);
    expect(() => verifyTestSendPreviewToken(token, claims, 2_000)).not.toThrow();
  });

  it("rejects bypass, tampering, mismatched requests, and expiry", () => {
    const token = createTestSendPreviewToken(claims, 1_000);
    expect(() => verifyTestSendPreviewToken("", claims, 2_000)).toThrowError(ApiError);
    expect(() => verifyTestSendPreviewToken(`${token}x`, claims, 2_000)).toThrowError(ApiError);
    expect(() => verifyTestSendPreviewToken(token, { ...claims, channel: "sms" }, 2_000))
      .toThrowError(ApiError);
    expect(() => verifyTestSendPreviewToken(token, claims, 1_000 + 10 * 60_000))
      .toThrowError(ApiError);
  });
});
