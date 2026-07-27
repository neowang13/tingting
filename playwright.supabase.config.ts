import { defineConfig, devices } from "@playwright/test";

if (process.env.E2E_SUPABASE_TEST_PROJECT_CONFIRMED !== "true") {
  throw new Error(
    "Refusing Supabase E2E: set E2E_SUPABASE_TEST_PROJECT_CONFIRMED=true only for a dedicated test project or local Supabase."
  );
}

const required = [
  "TEST_SUPABASE_URL",
  "TEST_SUPABASE_ANON_KEY",
  "TEST_SUPABASE_SERVICE_ROLE_KEY",
  "TEST_ADMIN_EMAIL",
  "TEST_ADMIN_PASSWORD",
  "TEST_ADMIN_TOTP_SECRET"
] as const;
const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
  throw new Error(`Supabase E2E configuration is incomplete: ${missing.join(", ")}`);
}

if (
  process.env.PRODUCTION_SUPABASE_URL &&
  process.env.PRODUCTION_SUPABASE_URL === process.env.TEST_SUPABASE_URL
) {
  throw new Error("Refusing Supabase E2E because the test and production project URLs match.");
}

const baseURL = process.env.TEST_APP_BASE_URL ?? "http://127.0.0.1:3300";
const base = new URL(baseURL);
if (!["127.0.0.1", "localhost"].includes(base.hostname)) {
  throw new Error("Supabase E2E must run against a local Next.js server.");
}

Object.assign(process.env, {
  NEXT_PUBLIC_SUPABASE_URL: process.env.TEST_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.TEST_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.TEST_SUPABASE_SERVICE_ROLE_KEY,
  DATA_BACKEND: "supabase",
  NEXT_PUBLIC_APP_MODE: "production",
  EMAIL_PROVIDER_MODE: "mock",
  SMS_PROVIDER_MODE: "mock",
  REMINDERS_FORCE_PAUSED: "true",
  APP_BASE_URL: baseURL,
  REMINDER_CRON_SECRET: "local-supabase-e2e-cron-secret"
});
const webServerEnvironment = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")
);

export default defineConfig({
  testDir: "./tests/e2e-supabase",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  reporter: [["line"]],
  use: {
    baseURL,
    channel: "chrome",
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  projects: [
    {
      name: "supabase-production-chrome",
      use: { ...devices["Desktop Chrome"] }
    }
  ],
  webServer: {
    command: `env NEXT_DIST_DIR=.next-e2e-supabase pnpm exec next dev -H ${base.hostname} -p ${base.port || "3300"}`,
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: webServerEnvironment
  }
});
