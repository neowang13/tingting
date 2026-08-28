import { ApiError } from "@/lib/api";
import type { EmailProvider, SendResult } from "@/features/notifications/providers/types";

const RESEND_MAX_EMAIL_BYTES = 40 * 1024 * 1024;

export class ResendEmailProvider implements EmailProvider {
  async send(input: Parameters<EmailProvider["send"]>[0]): Promise<SendResult> {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM;
    if (!apiKey || !from) {
      throw new ApiError(503, "EMAIL_PROVIDER_NOT_CONFIGURED", "Email delivery is not configured.");
    }

    const attachmentBytes = (input.attachments ?? []).reduce(
      (total, attachment) => total + Buffer.byteLength(attachment.content, "utf8"),
      0
    );
    const bodyBytes = Buffer.byteLength(input.html, "utf8") + Buffer.byteLength(input.text, "utf8");
    if (attachmentBytes + bodyBytes >= RESEND_MAX_EMAIL_BYTES) {
      throw new ApiError(400, "EMAIL_ATTACHMENTS_TOO_LARGE", "The email attachments exceed the provider size limit.");
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
        text: input.text,
        attachments: input.attachments?.length
          ? input.attachments.map((attachment) => ({
              filename: attachment.filename,
              content: attachment.content,
              content_type: attachment.contentType
            }))
          : undefined
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
