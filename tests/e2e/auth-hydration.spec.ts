import { expect, test } from '@playwright/test';

// Regression: credentials must never fall back to native GET submission while JS loads.
// Found during the full viewing/application QA journey on 2026-10-15.
const loginPages = [
  ['/client/login?next=%2Fclient%2Fapply%2Fhowe-street-one-bedroom', 'Sign in securely'],
  ['/admin', 'Sign In'],
  ['/client/signup', 'Create account']
];

for (const [path, buttonName] of loginPages) test(`${path} protects credentials before hydration`, async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL: test.info().project.use.baseURL });
  try {
    const page = await context.newPage();
    await page.goto(path);
    await expect(page.locator('form')).toHaveAttribute('method', 'post');
    await expect(page.getByRole('button', { name: buttonName })).toBeDisabled();
    await page.getByLabel('Email', { exact: true }).fill('synthetic@example.test');
    await page.getByLabel('Password', { exact: true }).fill('synthetic-test-password');
    await page.getByLabel('Password', { exact: true }).press('Enter');
    expect(page.url()).not.toMatch(/password=|email=/);
  } finally { await context.close(); }
});
