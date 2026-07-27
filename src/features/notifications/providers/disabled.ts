import { ApiError } from "@/lib/api";
import type {
  EmailProvider,
  SendResult,
  SmsProvider
} from "@/features/notifications/providers/types";

const NOT_CONFIGURED_MESSAGE =
  "Message delivery is disabled until the third-party provider is configured.";

export class DisabledEmailProvider implements EmailProvider {
  async send(): Promise<SendResult> {
    throw new ApiError(503, "EMAIL_PROVIDER_DISABLED", NOT_CONFIGURED_MESSAGE);
  }
}

export class DisabledSmsProvider implements SmsProvider {
  async send(): Promise<SendResult> {
    throw new ApiError(503, "SMS_PROVIDER_DISABLED", NOT_CONFIGURED_MESSAGE);
  }
}
