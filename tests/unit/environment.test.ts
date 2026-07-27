import { describe, expect, it } from "vitest";
import { readServerEnvironment } from "../../src/lib/env";

describe("server environment validation", () => {
  it("allows a local memory demo with mock providers", () => {
    expect(readServerEnvironment({
      NODE_ENV: "development",
      DATA_BACKEND: "memory",
      NEXT_PUBLIC_APP_MODE: "demo",
      EMAIL_PROVIDER_MODE: "mock",
      SMS_PROVIDER_MODE: "disabled",
      LOCAL_ADMIN_EMAIL: "admin@example.test",
      LOCAL_ADMIN_PASSWORD_HASH: "scrypt:16384:8:1:salt:hash",
      LOCAL_ADMIN_SESSION_SECRET: "test-session-secret-that-is-at-least-32-characters"
    }, { fresh: true })).toMatchObject({
      DATA_BACKEND: "memory",
      emailProviderMode: "mock",
      smsProviderMode: "disabled"
    });
  });

  it("allows live email while SMS remains disabled", () => {
    expect(readServerEnvironment({
      NODE_ENV: "development",
      DATA_BACKEND: "memory",
      NEXT_PUBLIC_APP_MODE: "demo",
      EMAIL_PROVIDER_MODE: "live",
      SMS_PROVIDER_MODE: "disabled",
      RESEND_API_KEY: "re_test",
      EMAIL_FROM: "Ting Ting <onboarding@resend.dev>",
      CONTACT_TO_EMAIL: "admin@example.test",
      ALERT_TO_EMAIL: "admin@example.test",
      RESEND_WEBHOOK_SECRET: "whsec_test"
    }, { fresh: true })).toMatchObject({
      emailProviderMode: "live",
      smsProviderMode: "disabled"
    });
  });

  it("does not require Twilio configuration for live email", () => {
    expect(() => readServerEnvironment({
      NODE_ENV: "development",
      DATA_BACKEND: "memory",
      NEXT_PUBLIC_APP_MODE: "demo",
      EMAIL_PROVIDER_MODE: "live",
      SMS_PROVIDER_MODE: "disabled",
      RESEND_API_KEY: "re_test",
      EMAIL_FROM: "Ting Ting <onboarding@resend.dev>",
      CONTACT_TO_EMAIL: "admin@example.test",
      ALERT_TO_EMAIL: "admin@example.test",
      RESEND_WEBHOOK_SECRET: "whsec_test"
    }, { fresh: true })).not.toThrow();
  });

  it("requires only Twilio configuration when SMS is live", () => {
    expect(readServerEnvironment({
      NODE_ENV: "development",
      DATA_BACKEND: "memory",
      NEXT_PUBLIC_APP_MODE: "demo",
      EMAIL_PROVIDER_MODE: "disabled",
      SMS_PROVIDER_MODE: "live",
      TWILIO_ACCOUNT_SID: "AC_test",
      TWILIO_AUTH_TOKEN: "test",
      TWILIO_MESSAGING_SERVICE_SID: "MG_test",
      TWILIO_STATUS_CALLBACK_URL: "https://example.test/api/webhooks/twilio"
    }, { fresh: true })).toMatchObject({
      emailProviderMode: "disabled",
      smsProviderMode: "live"
    });
  });

  it("allows a Twilio sender number for a restricted trial dry run", () => {
    expect(readServerEnvironment({
      NODE_ENV: "development",
      DATA_BACKEND: "memory",
      NEXT_PUBLIC_APP_MODE: "demo",
      EMAIL_PROVIDER_MODE: "disabled",
      SMS_PROVIDER_MODE: "live",
      TWILIO_ACCOUNT_SID: "AC_test",
      TWILIO_AUTH_TOKEN: "test",
      TWILIO_FROM_NUMBER: "+17372508034",
      TWILIO_STATUS_CALLBACK_URL: "https://example.test/api/webhooks/twilio"
    }, { fresh: true })).toMatchObject({
      smsProviderMode: "live",
      TWILIO_FROM_NUMBER: "+17372508034"
    });
  });

  it("requires either a Messaging Service or sender number when SMS is live", () => {
    expect(() => readServerEnvironment({
      NODE_ENV: "development",
      DATA_BACKEND: "memory",
      NEXT_PUBLIC_APP_MODE: "demo",
      EMAIL_PROVIDER_MODE: "disabled",
      SMS_PROVIDER_MODE: "live",
      TWILIO_ACCOUNT_SID: "AC_test",
      TWILIO_AUTH_TOKEN: "test",
      TWILIO_STATUS_CALLBACK_URL: "https://example.test/api/webhooks/twilio"
    }, { fresh: true })).toThrow("Required production services are not configured");
  });

  it("prevents production mode from starting on memory persistence", () => {
    expect(() => readServerEnvironment({
      NODE_ENV: "production",
      DATA_BACKEND: "memory",
      NEXT_PUBLIC_APP_MODE: "production"
    }, { fresh: true })).toThrow("Required production services are not configured");
  });

  it("requires a public HTTPS APP_BASE_URL in production", () => {
    expect(() => readServerEnvironment({
      NODE_ENV: "production",
      DATA_BACKEND: "supabase",
      NEXT_PUBLIC_APP_MODE: "production",
      NEXT_PUBLIC_SUPABASE_URL: "https://test-project.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon",
      SUPABASE_SERVICE_ROLE_KEY: "test-service",
      REMINDER_CRON_SECRET: "test-secret-that-is-at-least-24-characters",
      APP_BASE_URL: "http://localhost:3000",
      EMAIL_PROVIDER_MODE: "disabled",
      SMS_PROVIDER_MODE: "disabled"
    }, { fresh: true })).toThrow("Required production services are not configured");
  });

  it("requires the exact public Twilio callback when SMS is live in production", () => {
    expect(() => readServerEnvironment({
      NODE_ENV: "production",
      DATA_BACKEND: "supabase",
      NEXT_PUBLIC_APP_MODE: "production",
      NEXT_PUBLIC_SUPABASE_URL: "https://test-project.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon",
      SUPABASE_SERVICE_ROLE_KEY: "test-service",
      REMINDER_CRON_SECRET: "test-secret-that-is-at-least-24-characters",
      APP_BASE_URL: "https://admin.example.test",
      EMAIL_PROVIDER_MODE: "disabled",
      SMS_PROVIDER_MODE: "live",
      TWILIO_ACCOUNT_SID: "AC_test",
      TWILIO_AUTH_TOKEN: "test",
      TWILIO_MESSAGING_SERVICE_SID: "MG_test",
      TWILIO_STATUS_CALLBACK_URL: "https://other.example.test/twilio"
    }, { fresh: true })).toThrow("Required production services are not configured");
  });
});
