import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Deliberately opt in: this suite sends real mail but only writes disposable memory data.
if (process.env.E2E_LIVE_EMAIL_CONFIRMED !== 'true') throw new Error('Set E2E_LIVE_EMAIL_CONFIRMED=true to authorize real test emails.');
const recipient = process.env.E2E_EMAIL_RECIPIENT;
if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) throw new Error('E2E_EMAIL_RECIPIENT must be the authorized test mailbox.');
if (existsSync('.env.local')) process.loadEnvFile('.env.local');
if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) throw new Error('Real email credentials are missing.');

export default defineConfig({
  ...base,
  testDir: './tests/e2e-live-email',
  outputDir: './test-results/live-email',
  timeout: 120_000,
  use: { ...base.use, baseURL: 'http://127.0.0.1:3211' },
  webServer: {
    command: (base.webServer as { command: string }).command.replaceAll('3200', '3211')
      .replace('.next-e2e', '.next-email-qa').replace('EMAIL_PROVIDER_MODE=mock', 'EMAIL_PROVIDER_MODE=live'),
    url: 'http://127.0.0.1:3211/api/health',
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      CONTACT_TO_EMAIL: recipient, APPLICATION_TO_EMAIL: recipient,
      OWNER_NOTIFICATION_TO_EMAIL: recipient, ALERT_TO_EMAIL: recipient,
      OWNER_DAILY_OVERDUE_ENABLED: 'false', OWNER_WEEKLY_SUMMARY_ENABLED: 'false'
    }
  }
});
