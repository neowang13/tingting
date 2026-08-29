import { Webhook } from "svix";
import { handleApiError, ok, ApiError } from "@/lib/api";
import { isDemoMode } from "@/lib/auth";
import { getRepository } from "@/data/repository";
import { recordWebhookReceiptOnce } from "@/features/notifications/webhook-receipts";
import { mapResendStatus } from "@/features/notifications/provider-status";

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    if (isDemoMode() && request.headers.get("x-demo-webhook") === "1") {
      return ok({ accepted: true, provider: "resend", mode: "demo" }, requestId);
    }

    const secret = process.env.RESEND_WEBHOOK_SECRET;
    if (!secret) throw new ApiError(503, "PROVIDER_NOT_CONFIGURED", "Resend webhook verification is not configured.");
    const rawBody = await request.text();
    const webhookId = request.headers.get("svix-id") ?? "";
    let payload: { type?: string; data?: { email_id?: string } };
    try {
      payload = new Webhook(secret).verify(rawBody, {
        "svix-id": request.headers.get("svix-id") ?? "",
        "svix-timestamp": request.headers.get("svix-timestamp") ?? "",
        "svix-signature": request.headers.get("svix-signature") ?? ""
      }) as typeof payload;
    } catch {
      throw new ApiError(401, "INVALID_WEBHOOK_SIGNATURE", "The Resend signature is invalid.");
    }

    const providerMessageId = payload.data?.email_id;
    const providerStatus = payload.type;
    if (!providerMessageId || !providerStatus) {
      throw new ApiError(400, "INVALID_WEBHOOK_PAYLOAD", "The Resend event is missing its message identifier.");
    }
    if (!(await recordWebhookReceiptOnce("resend", webhookId, providerStatus))) {
      return ok({ accepted: true, duplicate: true }, requestId);
    }
    const mapped = mapResendStatus(providerStatus);
    const ownerDeliveryId = await getRepository().applyOwnerNotificationProviderStatus(
      providerMessageId,
      mapped,
      providerStatus
    );
    if (ownerDeliveryId) {
      return ok({ accepted: true, ownerDeliveryId }, requestId);
    }
    const event = await getRepository().applyProviderStatus("resend", providerMessageId, mapped, providerStatus);
    return ok({ accepted: true, eventId: event.id }, requestId);
  } catch (error) {
    return handleApiError(error, requestId);
  }
}
