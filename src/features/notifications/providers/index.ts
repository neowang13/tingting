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

export interface NotificationProviderModes {
  email: NotificationProviderMode;
  sms: NotificationProviderMode;
}

export interface NotificationProviders {
  emailMode: NotificationProviderMode;
  smsMode: NotificationProviderMode;
  email: EmailProvider;
  sms: SmsProvider;
}

function resolveProviderMode(
  channel: "EMAIL" | "SMS",
  configuredMode: string | undefined,
  fallback: NotificationProviderMode
): NotificationProviderMode {
  const mode = configuredMode || fallback;
  if (mode === "mock" || mode === "disabled" || mode === "live") return mode;

  throw new ApiError(
    500,
    `INVALID_${channel}_PROVIDER_MODE`,
    `${channel}_PROVIDER_MODE must be mock, disabled, or live.`
  );
}

export function resolveEmailProviderMode(
  configuredMode = process.env.EMAIL_PROVIDER_MODE
): NotificationProviderMode {
  return resolveProviderMode(
    "EMAIL",
    configuredMode,
    process.env.NODE_ENV === "production" ? "disabled" : "mock"
  );
}

export function resolveSmsProviderMode(
  configuredMode = process.env.SMS_PROVIDER_MODE
): NotificationProviderMode {
  return resolveProviderMode("SMS", configuredMode, "disabled");
}

export function resolveNotificationProviderModes(): NotificationProviderModes {
  return {
    email: resolveEmailProviderMode(),
    sms: resolveSmsProviderMode()
  };
}

function createEmailProvider(mode: NotificationProviderMode): EmailProvider {
  if (mode === "live") return new ResendEmailProvider();
  if (mode === "mock") return new MockEmailProvider();
  return new DisabledEmailProvider();
}

function createSmsProvider(mode: NotificationProviderMode): SmsProvider {
  if (mode === "live") return new TwilioSmsProvider();
  if (mode === "mock") return new MockSmsProvider();
  return new DisabledSmsProvider();
}

export function createNotificationProviders(
  modes = resolveNotificationProviderModes()
): NotificationProviders {
  return {
    emailMode: modes.email,
    smsMode: modes.sms,
    email: createEmailProvider(modes.email),
    sms: createSmsProvider(modes.sms)
  };
}

export const providers = createNotificationProviders();
