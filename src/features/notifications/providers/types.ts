export interface SendResult {
  providerMessageId: string;
  status: "queued" | "sent";
  providerStatus?: string;
}

export interface EmailProvider {
  send(input: {
    to: string;
    subject: string;
    html: string;
    text: string;
    idempotencyKey: string;
  }): Promise<SendResult>;
}

export interface SmsProvider {
  send(input: {
    to: string;
    body: string;
    statusCallbackUrl: string;
  }): Promise<SendResult>;
}
