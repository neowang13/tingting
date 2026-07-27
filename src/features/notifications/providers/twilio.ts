import { ApiError } from "@/lib/api";
import type { SendResult, SmsProvider } from "@/features/notifications/providers/types";

export class TwilioSmsProvider implements SmsProvider {
  async send(input: Parameters<SmsProvider["send"]>[0]): Promise<SendResult> {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
    const fromNumber = process.env.TWILIO_FROM_NUMBER;
    if (!accountSid || !authToken || (!messagingServiceSid && !fromNumber)) {
      throw new ApiError(503, "SMS_PROVIDER_NOT_CONFIGURED", "SMS delivery is not configured.");
    }

    const form = new URLSearchParams({
      To: input.to,
      Body: input.body,
      StatusCallback: input.statusCallbackUrl
    });
    if (messagingServiceSid) {
      form.set("MessagingServiceSid", messagingServiceSid);
    } else if (fromNumber) {
      form.set("From", fromNumber);
    }
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
      {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded"
        },
        body: form,
        signal: AbortSignal.timeout(15_000)
      }
    );
    const result = (await response.json()) as { sid?: string; status?: string };
    if (!response.ok || !result.sid) {
      throw new ApiError(502, "SMS_PROVIDER_REJECTED", "The SMS provider rejected the request.");
    }
    return {
      providerMessageId: result.sid,
      status: result.status === "sent" ? "sent" : "queued",
      providerStatus: result.status
    };
  }
}
