import twilio from "twilio";
import { handleApiError, ok, ApiError } from "@/lib/api";
import { isDemoMode } from "@/lib/auth";
import { getRepository } from "@/data/repository";
import { recordWebhookReceiptOnce } from "@/features/notifications/webhook-receipts";
import { mapTwilioStatus } from "@/features/notifications/provider-status";

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    if (isDemoMode() && request.headers.get("x-demo-webhook") === "1") {
      return ok({ accepted: true, provider: "twilio", mode: "demo" }, requestId);
    }

    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const callbackUrl = process.env.TWILIO_STATUS_CALLBACK_URL;
    const signature = request.headers.get("x-twilio-signature");
    if (!authToken || !callbackUrl) {
      throw new ApiError(503, "PROVIDER_NOT_CONFIGURED", "Twilio webhook verification is not configured.");
    }
    if (!signature) throw new ApiError(401, "INVALID_WEBHOOK_SIGNATURE", "The Twilio signature is missing.");

    const form = await request.formData();
    const params = Object.fromEntries(Array.from(form.entries()).map(([key, value]) => [key, String(value)]));
    if (!twilio.validateRequest(authToken, signature, callbackUrl, params)) {
      throw new ApiError(401, "INVALID_WEBHOOK_SIGNATURE", "The Twilio signature is invalid.");
    }

    const messageSid = params.MessageSid;
    const providerStatus = params.MessageStatus;
    if (!messageSid || !providerStatus) {
      throw new ApiError(400, "INVALID_WEBHOOK_PAYLOAD", "MessageSid and MessageStatus are required.");
    }
    const safeProviderStatus = params.ErrorCode ? `${providerStatus}:${params.ErrorCode}` : providerStatus;
    if (!(await recordWebhookReceiptOnce("twilio", `${messageSid}:${safeProviderStatus}`, safeProviderStatus))) {
      return ok({ accepted: true, duplicate: true }, requestId);
    }
    const mapped = mapTwilioStatus(providerStatus);
    const event = await getRepository().applyProviderStatus("twilio", messageSid, mapped, safeProviderStatus);
    return ok({ accepted: true, eventId: event.id }, requestId);
  } catch (error) {
    return handleApiError(error, requestId);
  }
}
