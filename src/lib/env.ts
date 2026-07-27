import { z } from "zod";
import { ApiError } from "@/lib/api";

const baseEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATA_BACKEND: z.enum(["memory", "supabase"]).default("memory"),
  NEXT_PUBLIC_APP_MODE: z.enum(["demo", "production"]).default("demo"),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  LOCAL_ADMIN_EMAIL: z.string().email().optional(),
  LOCAL_ADMIN_PASSWORD_HASH: z.string().min(1).optional(),
  LOCAL_ADMIN_SESSION_SECRET: z.string().min(32).optional(),
  LOCAL_ADMIN_DISPLAY_NAME: z.string().min(1).default("Ting Ting Xu"),
  SUPABASE_STORAGE_PUBLIC_BUCKET: z.string().min(1).default("site-media"),
  SUPABASE_STORAGE_DRAFT_BUCKET: z.string().min(1).default("site-media-drafts"),
  REMINDER_CRON_SECRET: z.string().min(24).optional(),
  EMAIL_PROVIDER_MODE: z.enum(["mock", "disabled", "live"]).optional(),
  SMS_PROVIDER_MODE: z.enum(["mock", "disabled", "live"]).optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().min(3).optional(),
  CONTACT_TO_EMAIL: z.string().email().optional(),
  ALERT_TO_EMAIL: z.string().email().optional(),
  RESEND_WEBHOOK_SECRET: z.string().min(1).optional(),
  TWILIO_ACCOUNT_SID: z.string().min(1).optional(),
  TWILIO_AUTH_TOKEN: z.string().min(1).optional(),
  TWILIO_MESSAGING_SERVICE_SID: z.string().min(1).optional(),
  TWILIO_FROM_NUMBER: z.string().regex(/^\+[1-9]\d{7,14}$/).optional(),
  TWILIO_STATUS_CALLBACK_URL: z.string().url().optional(),
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),
  DEFAULT_TIMEZONE: z.string().min(1).default("America/Vancouver"),
  REMINDERS_FORCE_PAUSED: z.enum(["true", "false"]).default("true"),
  AUTOMATION_API_ENABLED: z.enum(["true", "false"]).default("false"),
  AUTOMATION_MUTATIONS_ENABLED: z.enum(["true", "false"]).default("false"),
  AUTOMATION_CONFIRMATIONS_ENABLED: z.enum(["true", "false"]).default("false"),
  AUTOMATION_TENANT_IMPORT_ENABLED: z.enum(["true", "false"]).default("false"),
  AUTOMATION_TOKEN_PEPPER: z.string().min(32).optional(),
  AUTOMATION_IMPORT_BUCKET: z.string().min(1).default("automation-imports")
});

export type ServerEnvironment = z.infer<typeof baseEnvSchema> & {
  emailProviderMode: "mock" | "disabled" | "live";
  smsProviderMode: "mock" | "disabled" | "live";
  remindersForcePaused: boolean;
};

let cachedEnvironment: ServerEnvironment | undefined;

function cleanEnvironment(source: NodeJS.ProcessEnv) {
  return Object.fromEntries(
    Object.entries(source).map(([key, value]) => [key, value === "" ? undefined : value])
  );
}

export function readServerEnvironment(
  source: NodeJS.ProcessEnv = process.env,
  options: { fresh?: boolean } = {}
): ServerEnvironment {
  if (!options.fresh && source === process.env && cachedEnvironment) return cachedEnvironment;

  const parsed = baseEnvSchema.safeParse(cleanEnvironment(source));
  if (!parsed.success) {
    throw new ApiError(500, "INVALID_ENVIRONMENT", "Server configuration is invalid.", parsed.error.flatten());
  }

  const value = parsed.data;
  const emailProviderMode =
    value.EMAIL_PROVIDER_MODE ?? (value.NODE_ENV === "production" ? "disabled" : "mock");
  const smsProviderMode = value.SMS_PROVIDER_MODE ?? "disabled";

  const missing: string[] = [];
  if (value.DATA_BACKEND === "supabase") {
    if (!value.NEXT_PUBLIC_SUPABASE_URL) missing.push("NEXT_PUBLIC_SUPABASE_URL");
    if (!value.NEXT_PUBLIC_SUPABASE_ANON_KEY) missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    if (!value.SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
    if (!value.REMINDER_CRON_SECRET) missing.push("REMINDER_CRON_SECRET");
    if (value.AUTOMATION_API_ENABLED === "true" && !value.AUTOMATION_TOKEN_PEPPER) {
      missing.push("AUTOMATION_TOKEN_PEPPER");
    }
  }
  if (emailProviderMode === "live") {
    if (!value.RESEND_API_KEY) missing.push("RESEND_API_KEY");
    if (!value.EMAIL_FROM) missing.push("EMAIL_FROM");
    if (!value.RESEND_WEBHOOK_SECRET) missing.push("RESEND_WEBHOOK_SECRET");
    if (!value.CONTACT_TO_EMAIL) missing.push("CONTACT_TO_EMAIL");
    if (!value.ALERT_TO_EMAIL) missing.push("ALERT_TO_EMAIL");
  }
  if (smsProviderMode === "live") {
    if (!value.TWILIO_ACCOUNT_SID) missing.push("TWILIO_ACCOUNT_SID");
    if (!value.TWILIO_AUTH_TOKEN) missing.push("TWILIO_AUTH_TOKEN");
    if (!value.TWILIO_MESSAGING_SERVICE_SID && !value.TWILIO_FROM_NUMBER) {
      missing.push("TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM_NUMBER");
    }
    if (!value.TWILIO_STATUS_CALLBACK_URL) missing.push("TWILIO_STATUS_CALLBACK_URL");
  }
  if (
    value.NODE_ENV === "production" &&
    value.NEXT_PUBLIC_APP_MODE === "production" &&
    value.DATA_BACKEND === "memory"
  ) {
    missing.push("DATA_BACKEND=supabase");
  }
  if (value.NODE_ENV === "production" && value.NEXT_PUBLIC_APP_MODE === "production") {
    const baseUrl = new URL(value.APP_BASE_URL);
    if (
      baseUrl.protocol !== "https:" ||
      ["localhost", "127.0.0.1"].includes(baseUrl.hostname) ||
      baseUrl.username ||
      baseUrl.password ||
      baseUrl.search ||
      baseUrl.hash
    ) {
      missing.push("APP_BASE_URL (public HTTPS URL)");
    }
    if (smsProviderMode === "live" && value.TWILIO_STATUS_CALLBACK_URL) {
      const callback = new URL(value.TWILIO_STATUS_CALLBACK_URL);
      const expectedCallback = new URL("/api/webhooks/twilio", baseUrl);
      if (
        callback.protocol !== "https:" ||
        callback.href !== expectedCallback.href
      ) {
        missing.push(`TWILIO_STATUS_CALLBACK_URL=${expectedCallback.href}`);
      }
    }
  }

  if (missing.length > 0) {
    throw new ApiError(
      503,
      "SERVICE_CONFIGURATION_INCOMPLETE",
      "Required production services are not configured.",
      { missing }
    );
  }

  const environment: ServerEnvironment = {
    ...value,
    emailProviderMode,
    smsProviderMode,
    remindersForcePaused: value.REMINDERS_FORCE_PAUSED === "true"
  };
  if (source === process.env) cachedEnvironment = environment;
  return environment;
}

export function resetEnvironmentCache() {
  cachedEnvironment = undefined;
}
