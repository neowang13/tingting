import type {
  EmailProvider,
  SendResult,
  SmsProvider
} from "@/features/notifications/providers/types";

function mockResult(channel: "email" | "sms"): SendResult {
  return {
    providerMessageId: `mock-${channel}-${crypto.randomUUID()}`,
    status: "queued",
    providerStatus: "mock_queued"
  };
}

async function mockLatency() {
  const configured = Number(process.env.MOCK_PROVIDER_LATENCY_MS ?? 0);
  const milliseconds = Number.isFinite(configured)
    ? Math.max(0, Math.min(configured, 2_000))
    : 0;
  if (milliseconds > 0) {
    await new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
}

/**
 * Development-only providers that satisfy the real provider contracts without
 * making a network request or delivering a message.
 */
export class MockEmailProvider implements EmailProvider {
  async send(): Promise<SendResult> {
    await mockLatency();
    return mockResult("email");
  }
}

export class MockSmsProvider implements SmsProvider {
  async send(): Promise<SendResult> {
    await mockLatency();
    return mockResult("sms");
  }
}
