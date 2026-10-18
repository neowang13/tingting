import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { applicationDraftSchema } from '../../src/features/applications/schemas';

// Audit rendered text pixels, including inherited colors and group opacity.
// Axe intentionally exempts disabled controls; these must remain readable too.
async function expectReadableButtons(page: Page) {
  const result = await page.evaluate(() => {
    type Pixel = [number, number, number, number];
    const parse = (color: string): Pixel => {
      const values = color.match(/[\d.]+/g)?.map(Number) ?? [];
      return [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0, values[3] ?? 1];
    };
    const over = (front: Pixel, back: Pixel): Pixel => {
      const alpha = front[3] + back[3] * (1 - front[3]);
      return [0, 1, 2].map(i => alpha ? (front[i] * front[3] + back[i] * back[3] * (1 - front[3])) / alpha : 0).concat(alpha) as Pixel;
    };
    const pixel = (element: Element, text: boolean): Pixel => {
      let value: Pixel = text ? parse(getComputedStyle(element).color) : [0, 0, 0, 0];
      for (let current: Element | null = element; current; current = current.parentElement) {
        const style = getComputedStyle(current);
        value = over(value, parse(style.backgroundColor));
        value[3] *= Number(style.opacity);
      }
      return over(value, [255, 255, 255, 1]);
    };
    const luminance = (color: Pixel) => color.slice(0, 3).map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4)
      .reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
    const failures: Array<{ text: string; control: string; ratio: number; disabled: boolean }> = [];
    let checked = 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const element = node.parentElement;
      const text = node.textContent?.trim();
      const control = element?.closest('button, a.button, a.admin-action, [role="button"], .application-file-picker');
      if (!element || !text || !/[\p{L}\p{N}]/u.test(text) || !control || element.closest('[aria-hidden="true"]')) continue;
      const range = document.createRange(); range.selectNodeContents(node);
      if (!range.getBoundingClientRect().width || getComputedStyle(element).visibility !== 'visible') continue;
      const foreground = luminance(pixel(element, true));
      const background = luminance(pixel(element, false));
      const ratio = (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05);
      checked++;
      if (ratio < 4.5) failures.push({ text, control: control.className, ratio: Math.round(ratio * 100) / 100, disabled: control.matches(':disabled,[aria-disabled="true"]') });
    }
    return { checked, failures };
  });
  expect(result.checked, `No text controls audited at ${page.url()}`).toBeGreaterThan(0);
  expect(result.failures, `Unreadable button text at ${page.url()}`).toEqual([]);
}

async function checkButtonStates(page: Page) {
  // The development indicator overlaps the Admin sidebar footer; it is absent
  // from production and must not intercept hover checks for application controls.
  await page.addStyleTag({ content: 'nextjs-portal { pointer-events: none; }' });
  await page.waitForTimeout(200); // settle initial hydration and button color transitions
  await expectReadableButtons(page);
  // Hover every rendered text action without triggering an application mutation.
  const controls = page.locator(':is(.admin-route, .client-route) :is(button, a.button, a.admin-action, [role="button"])');
  const states = new Set<string>();
  for (const control of await controls.all()) {
    if (!(await control.isVisible()) || !(await control.innerText()).trim()) continue;
    const key = await control.evaluate(element => [element.tagName, element.className, element.matches(':disabled,[aria-disabled="true"]'), element.getAttribute('aria-selected'), element.parentElement?.className, element.parentElement?.parentElement?.className].join('|'));
    if (states.has(key)) continue;
    states.add(key);
    await test.step(`Hover ${(await control.innerText()).trim()}: ${key}`, async () => {
      await control.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
      await control.hover({ timeout: 3000 });
      await page.waitForTimeout(180); // allow the color transition to finish
      await expectReadableButtons(page);
    });
  }
}

async function login(page: Page, admin = false) {
  await page.goto(admin ? '/admin/login' : '/client/login');
  await page.getByLabel('Email', { exact: true }).fill(admin ? 'admin@example.test' : 'client@example.test');
  await page.getByLabel('Password', { exact: true }).fill('test-admin-password');
  await page.getByRole('button', { name: admin ? 'Sign In' : 'Sign in securely', exact: true }).click();
  await expect(page).toHaveURL(admin ? /\/admin\/properties$/ : /\/$/);
}

test('applicant list links and all wizard action labels are readable', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/client/login');
  await checkButtonStates(page);
  await login(page);
  await page.goto('/client/applications');
  await expect(page.getByRole('heading', { name: 'My applications', exact: true })).toBeVisible();
  await checkButtonStates(page);
  await mkdir('.tmp/button-contrast', { recursive: true });
  await page.screenshot({ path: '.tmp/button-contrast/client-list-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await checkButtonStates(page);
  await page.screenshot({ path: '.tmp/button-contrast/client-list-mobile.png', fullPage: true });
  await page.getByRole('link', { name: 'Continue application', exact: true }).first().click();
  for (let step = 1; step <= 8; step++) {
    await page.getByRole('button', { name: new RegExp(`Step ${step} `, 'i') }).click();
    await checkButtonStates(page);
  }
  await page.goto('/client/invitations?invitation=contrast-check');
  await checkButtonStates(page);
});

test('Admin lists, editors, dialogs and calendar keep action labels readable', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/admin/login');
  await checkButtonStates(page);
  await login(page, true);
  const paths = ['/admin/properties', '/admin/properties/new', '/admin/applications', '/admin/users', '/admin/tenants'];
  for (const path of paths) {
    await page.goto(path);
    console.log('Checking Admin action colors:', path);
    await expect(page.locator('.admin-route')).toBeVisible();
    await checkButtonStates(page);
    if (path === '/admin/properties/new') {
      await mkdir('.tmp/button-contrast', { recursive: true });
      await page.screenshot({ path: '.tmp/button-contrast/admin-editor.png', fullPage: false });
    }
    if (path === '/admin/applications' && await page.getByRole('button', { name: 'Review application', exact: true }).count()) {
      await page.getByRole('button', { name: 'Review application', exact: true }).first().click();
      await checkButtonStates(page);
      await page.getByRole('button', { name: 'Close application review', exact: true }).click();
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/admin/properties/new');
  await checkButtonStates(page);
});

test('signed-out co-applicant action links have readable primary and secondary labels', async ({ page }) => {
  await page.goto('/application/guest');
  await expect(page.getByRole('link', { name: 'Sign in to accept', exact: true })).toBeVisible();
  await checkButtonStates(page);
});


test('co-applicant personal, tenancy, documents and signing controls stay readable', async ({ page }) => {
  test.setTimeout(90_000);
  await login(page);
  const draft = applicationDraftSchema.parse({ personal: { legalFirstName: 'Example', legalLastName: 'Applicant', email: 'client@example.test' } });
  await page.route('**/api/application-guests/session', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: {
    application: { id: '30000000-0000-4000-8000-000000000009', propertyTitle: 'Contrast test rental', propertyAddress: 'Example Street', formVersion: 'test', formSha256: 'a'.repeat(64), termsVersion: 'test', termsSha256: 'b'.repeat(64), termsText: 'Fictional test notice.' },
    applicant: { id: '40000000-0000-4000-8000-000000000001', legalName: 'Example Applicant', email: 'client@example.test', status: 'in_progress', draft, draftUpdatedAt: null, files: [], signedAt: null }
  } }) }));
  await page.goto('/application/guest');
  await expect(page.locator('.guest-form-panel')).toBeVisible();
  for (const name of ['1 Personal', '2 Tenancy', '3 Housing & income', '4 Contacts', '5 Documents', '6 Review & sign']) {
    await page.getByRole('button', { name, exact: true }).click();
    await checkButtonStates(page);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await checkButtonStates(page);
});
