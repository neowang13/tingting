import { describe, expect, it } from "vitest";
import {
  createNotificationProviders,
  resolveNotificationProviderMode
} from "../../src/features/notifications/providers";

const emailInput = {
  to: "admin@example.test",
  subject: "Test reminder",
  html: "<p>Test reminder</p>",
  text: "Test reminder",
  idempotencyKey: "test-email-request"
};

const smsInput = {
  to: "+16045550123",
  body: "Test reminder",
  statusCallbackUrl: "https://example.test/webhooks/twilio"
};

describe("notification provider modes", () => {
  it("uses network-free mock providers for development and tests", async () => {
    const providers = createNotificationProviders("mock");

    await expect(providers.email.send(emailInput)).resolves.toMatchObject({
      status: "queued",
      providerStatus: "mock_queued"
    });
    await expect(providers.sms.send(smsInput)).resolves.toMatchObject({
      status: "queued",
      providerStatus: "mock_queued"
    });
  });

  it("fails closed when delivery is disabled", async () => {
    const providers = createNotificationProviders("disabled");

    await expect(providers.email.send(emailInput)).rejects.toMatchObject({
      status: 503,
      code: "EMAIL_PROVIDER_DISABLED"
    });
    await expect(providers.sms.send(smsInput)).rejects.toMatchObject({
      status: 503,
      code: "SMS_PROVIDER_DISABLED"
    });
  });

  it("rejects an unknown provider mode", () => {
    expect(() => resolveNotificationProviderMode("preview")).toThrow(
      "NOTIFICATION_PROVIDER_MODE must be mock, disabled, or live."
    );
  });
});
