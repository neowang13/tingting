import { defineConfig } from '@playwright/test';
import base from './playwright.config';
export default defineConfig({
  ...base,
  testDir: './tests/e2e',
  outputDir: './test-results/flows-qa',
  use: { ...base.use, baseURL: 'http://127.0.0.1:3210' },
  webServer: {
    ...base.webServer as object,
    command: (base.webServer as { command: string }).command.replaceAll('3200', '3210').replace('.next-e2e', '.next-flows-qa'),
    url: 'http://127.0.0.1:3210/api/health',
    reuseExistingServer: false,
    timeout: 60_000
  }
});
