import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createNotificationProviders,
  resolveEmailProviderMode,
  resolveSmsProviderMode
} from "../../src/features/notifications/providers";
import { TwilioSmsProvider } from "../../src/features/notifications/providers/twilio";

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
  const originalTwilioEnvironment = {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
    fromNumber: process.env.TWILIO_FROM_NUMBER
  };

  afterEach(() => {
    process.env.TWILIO_ACCOUNT_SID = originalTwilioEnvironment.accountSid;
    process.env.TWILIO_AUTH_TOKEN = originalTwilioEnvironment.authToken;
    process.env.TWILIO_MESSAGING_SERVICE_SID = originalTwilioEnvironment.messagingServiceSid;
    process.env.TWILIO_FROM_NUMBER = originalTwilioEnvironment.fromNumber;
    vi.restoreAllMocks();
  });

  it("uses network-free mock providers for development and tests", async () => {
    const providers = createNotificationProviders({ email: "mock", sms: "mock" });

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
    const providers = createNotificationProviders({ email: "disabled", sms: "disabled" });

    await expect(providers.email.send(emailInput)).rejects.toMatchObject({
      status: 503,
      code: "EMAIL_PROVIDER_DISABLED"
    });
    await expect(providers.sms.send(smsInput)).rejects.toMatchObject({
      status: 503,
      code: "SMS_PROVIDER_DISABLED"
    });
  });

  it("allows email and SMS modes to differ", async () => {
    const providers = createNotificationProviders({ email: "mock", sms: "disabled" });

    await expect(providers.email.send(emailInput)).resolves.toMatchObject({
      providerStatus: "mock_queued"
    });
    await expect(providers.sms.send(smsInput)).rejects.toMatchObject({
      code: "SMS_PROVIDER_DISABLED"
    });
  });

  it("rejects unknown channel-specific provider modes", () => {
    expect(() => resolveEmailProviderMode("preview")).toThrow(
      "EMAIL_PROVIDER_MODE must be mock, disabled, or live."
    );
    expect(() => resolveSmsProviderMode("preview")).toThrow(
      "SMS_PROVIDER_MODE must be mock, disabled, or live."
    );
  });

  it("uses a configured sender number for a Twilio trial dry run", async () => {
    process.env.TWILIO_ACCOUNT_SID = "AC_test";
    process.env.TWILIO_AUTH_TOKEN = "test-token";
    delete process.env.TWILIO_MESSAGING_SERVICE_SID;
    process.env.TWILIO_FROM_NUMBER = "+17372508034";

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
      JSON.stringify({ sid: "SM_test", status: "queued" }),
      { status: 201, headers: { "content-type": "application/json" } }
    ));

    await expect(new TwilioSmsProvider().send(smsInput)).resolves.toMatchObject({
      providerMessageId: "SM_test",
      status: "queued"
    });

    const request = fetchMock.mock.calls[0]?.[1];
    expect(request?.body?.toString()).toContain("From=%2B17372508034");
    expect(request?.body?.toString()).not.toContain("MessagingServiceSid");
  });

  it("prefers a Messaging Service when both Twilio senders are configured", async () => {
    process.env.TWILIO_ACCOUNT_SID = "AC_test";
    process.env.TWILIO_AUTH_TOKEN = "test-token";
    process.env.TWILIO_MESSAGING_SERVICE_SID = "MG_test";
    process.env.TWILIO_FROM_NUMBER = "+17372508034";

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
      JSON.stringify({ sid: "SM_test", status: "queued" }),
      { status: 201, headers: { "content-type": "application/json" } }
    ));

    await new TwilioSmsProvider().send(smsInput);

    const request = fetchMock.mock.calls[0]?.[1];
    expect(request?.body?.toString()).toContain("MessagingServiceSid=MG_test");
    expect(request?.body?.toString()).not.toContain("From=");
  });
});
