import { ApiError } from "@/lib/api";
import {
  DisabledEmailProvider,
  DisabledSmsProvider
} from "@/features/notifications/providers/disabled";
import {
  MockEmailProvider,
  MockSmsProvider
} from "@/features/notifications/providers/mock";
import { ResendEmailProvider } from "@/features/notifications/providers/resend";
import { TwilioSmsProvider } from "@/features/notifications/providers/twilio";
import type {
  EmailProvider,
  SmsProvider
} from "@/features/notifications/providers/types";

export type NotificationProviderMode = "mock" | "disabled" | "live";

export interface NotificationProviders {
  mode: NotificationProviderMode;
  email: EmailProvider;
  sms: SmsProvider;
}

export function resolveNotificationProviderMode(
  configuredMode = process.env.NOTIFICATION_PROVIDER_MODE
): NotificationProviderMode {
  const mode = configuredMode || (process.env.NODE_ENV === "production" ? "disabled" : "mock");
  if (mode === "mock" || mode === "disabled" || mode === "live") return mode;

  throw new ApiError(
    500,
    "INVALID_NOTIFICATION_PROVIDER_MODE",
    "NOTIFICATION_PROVIDER_MODE must be mock, disabled, or live."
  );
}

export function createNotificationProviders(
  mode = resolveNotificationProviderMode()
): NotificationProviders {
  if (mode === "live") {
    return {
      mode,
      email: new ResendEmailProvider(),
      sms: new TwilioSmsProvider()
    };
  }

  if (mode === "mock") {
    return {
      mode,
      email: new MockEmailProvider(),
      sms: new MockSmsProvider()
    };
  }

  return {
    mode,
    email: new DisabledEmailProvider(),
    sms: new DisabledSmsProvider()
  };
}

export const providers = createNotificationProviders();
