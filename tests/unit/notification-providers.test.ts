import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createNotificationProviders,
  resolveEmailProviderMode,
  resolveSmsProviderMode
} from "../../src/features/notifications/providers";
import { TwilioSmsProvider } from "../../src/features/notifications/providers/twilio";
import { ResendEmailProvider } from "../../src/features/notifications/providers/resend";

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
    vi.unstubAllEnvs();
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

  it("sends Base64 attachment content through Resend", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "Silverkey <notifications@silverkey.ca>");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
      JSON.stringify({ id: "email-with-attachments" }),
      { status: 200, headers: { "content-type": "application/json" } }
    ));

    await new ResendEmailProvider().send({
      ...emailInput,
      attachments: [{
        filename: "application.pdf",
        content: Buffer.from("%PDF-1.7").toString("base64"),
        contentType: "application/pdf"
      }]
    });

    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(payload.attachments).toEqual([{
      filename: "application.pdf",
      content: Buffer.from("%PDF-1.7").toString("base64"),
      content_type: "application/pdf"
    }]);
  });

  it("keeps attachment-free Resend emails backward compatible", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "Silverkey <notifications@silverkey.ca>");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
      JSON.stringify({ id: "email-without-attachments" }),
      { status: 200, headers: { "content-type": "application/json" } }
    ));

    await new ResendEmailProvider().send(emailInput);
    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(payload).not.toHaveProperty("attachments");
  });

  it("rejects oversized attachment bodies before calling Resend", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "Silverkey <notifications@silverkey.ca>");
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(new ResendEmailProvider().send({
      ...emailInput,
      attachments: [{
        filename: "too-large.pdf",
        content: "A".repeat(40 * 1024 * 1024),
        contentType: "application/pdf"
      }]
    })).rejects.toMatchObject({ code: "EMAIL_ATTACHMENTS_TOO_LARGE" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed for missing Resend configuration and provider rejection", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("EMAIL_FROM", "");
    await expect(new ResendEmailProvider().send(emailInput))
      .rejects.toMatchObject({ code: "EMAIL_PROVIDER_NOT_CONFIGURED" });

    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "Silverkey <notifications@silverkey.ca>");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
      JSON.stringify({ message: "rejected" }),
      { status: 422, headers: { "content-type": "application/json" } }
    ));
    await expect(new ResendEmailProvider().send(emailInput))
      .rejects.toMatchObject({ code: "EMAIL_PROVIDER_REJECTED" });
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
