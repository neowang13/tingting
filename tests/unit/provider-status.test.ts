import { describe, expect, it } from "vitest";
import {
  mapResendStatus,
  mapTwilioStatus
} from "../../src/features/notifications/provider-status";

describe("provider status mapping", () => {
  it("maps Resend statuses without moving failures into success", () => {
    expect(mapResendStatus("email.delivered")).toBe("delivered");
    expect(mapResendStatus("email.bounced")).toBe("undelivered");
    expect(mapResendStatus("email.complained")).toBe("undelivered");
    expect(mapResendStatus("email.failed")).toBe("failed");
  });

  it("maps Twilio carrier states conservatively", () => {
    expect(mapTwilioStatus("delivered")).toBe("delivered");
    expect(mapTwilioStatus("undelivered")).toBe("undelivered");
    expect(mapTwilioStatus("failed")).toBe("failed");
    expect(mapTwilioStatus("accepted")).toBe("queued");
  });
});
