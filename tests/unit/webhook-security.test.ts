import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as resendWebhook } from "../../src/app/api/webhooks/resend/route";
import { POST as twilioWebhook } from "../../src/app/api/webhooks/twilio/route";
import { recordWebhookReceiptOnce } from "../../src/features/notifications/webhook-receipts";

describe("provider webhook security", () => {
  const originalEnvironment = {
    backend: process.env.DATA_BACKEND,
    resendSecret: process.env.RESEND_WEBHOOK_SECRET,
    twilioToken: process.env.TWILIO_AUTH_TOKEN,
    twilioUrl: process.env.TWILIO_STATUS_CALLBACK_URL
  };

  beforeEach(() => {
    process.env.DATA_BACKEND = "memory";
    globalThis.__tingtingWebhookReceipts = new Set();
  });

  afterEach(() => {
    process.env.DATA_BACKEND = originalEnvironment.backend;
    process.env.RESEND_WEBHOOK_SECRET = originalEnvironment.resendSecret;
    process.env.TWILIO_AUTH_TOKEN = originalEnvironment.twilioToken;
    process.env.TWILIO_STATUS_CALLBACK_URL = originalEnvironment.twilioUrl;
    globalThis.__tingtingWebhookReceipts = undefined;
  });

  it("rejects invalid Resend signatures before applying a status", async () => {
    process.env.RESEND_WEBHOOK_SECRET = "whsec_dGVzdC1vbmx5LXNlY3JldA==";
    const response = await resendWebhook(new Request("https://example.test/api/webhooks/resend", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "svix-id": "evt_invalid",
        "svix-timestamp": String(Math.floor(Date.now() / 1000)),
        "svix-signature": "v1,invalid"
      },
      body: JSON.stringify({ type: "email.delivered", data: { email_id: "email_1" } })
    }));
    expect(response.status).toBe(401);
  });

  it("rejects invalid Twilio signatures before applying a status", async () => {
    process.env.TWILIO_AUTH_TOKEN = "test-token";
    process.env.TWILIO_STATUS_CALLBACK_URL = "https://example.test/api/webhooks/twilio";
    const response = await twilioWebhook(new Request(process.env.TWILIO_STATUS_CALLBACK_URL, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": "invalid"
      },
      body: new URLSearchParams({ MessageSid: "SM123", MessageStatus: "delivered" })
    }));
    expect(response.status).toBe(401);
  });

  it("stores provider receipts idempotently", async () => {
    await expect(recordWebhookReceiptOnce("resend", "evt_1", "email.delivered")).resolves.toBe(true);
    await expect(recordWebhookReceiptOnce("resend", "evt_1", "email.delivered")).resolves.toBe(false);
  });
});
