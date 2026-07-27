import { ApiError } from "@/lib/api";
import type { EmailProvider, SendResult } from "@/features/notifications/providers/types";

export class ResendEmailProvider implements EmailProvider {
  async send(input: Parameters<EmailProvider["send"]>[0]): Promise<SendResult> {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM;
    if (!apiKey || !from) {
      throw new ApiError(503, "EMAIL_PROVIDER_NOT_CONFIGURED", "Email delivery is not configured.");
    }

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "idempotency-key": input.idempotencyKey
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text
      }),
      signal: AbortSignal.timeout(15_000)
    });

    const result = (await response.json()) as { id?: string; message?: string };
    if (!response.ok || !result.id) {
      throw new ApiError(502, "EMAIL_PROVIDER_REJECTED", "The email provider rejected the request.");
    }
    return { providerMessageId: result.id, status: "queued", providerStatus: "queued" };
  }
}
