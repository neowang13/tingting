import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  reporter: [["line"]],
  use: {
    baseURL: "http://127.0.0.1:3200",
    channel: "chrome",
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  projects: [
    {
      name: "desktop-chrome",
      use: { ...devices["Desktop Chrome"] }
    }
  ],
  webServer: {
    command:
      "env NEXT_DIST_DIR=.next-e2e DATA_BACKEND=memory NEXT_PUBLIC_APP_MODE=demo NOTIFICATION_PROVIDER_MODE=mock REMINDERS_FORCE_PAUSED=true APP_BASE_URL=http://127.0.0.1:3200 LOCAL_ADMIN_EMAIL=admin@example.test LOCAL_ADMIN_PASSWORD_HASH=scrypt:16384:8:1:yOFFQBMzNECrjrDUOOaNng:jrH2McTmfq8CsHuLWbUXUNkR_5-apU4s1_M0aT_KvjR6F42rsZJAhS86u-xolEfa7j9azZqaf7LagPaa6Jbr1A LOCAL_ADMIN_SESSION_SECRET=FFugT8wlbSjnkG4c5PDb0exVO-N3Yc-DvfsttbRQC0aZrlC-aHBWtwEjvOxhiw8e pnpm exec next dev -H 127.0.0.1 -p 3200",
    url: "http://127.0.0.1:3200/api/health",
    reuseExistingServer: true,
    timeout: 30_000
  }
});
