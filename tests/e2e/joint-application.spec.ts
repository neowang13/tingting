import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { applicationDraftSchema } from '../../src/features/applications/schemas';

const password = 'test-admin-password';
const pdf = (name: string) => ({ name, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n% FICTIONAL TEST ONLY\n%%EOF') });

for (const signingOrder of ['co-first', 'primary-first'] as const) {
test(`two verified User accounts complete a joint application in ${signingOrder} order`, async ({ page, browser }) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(10_000);
  const propertySlug = signingOrder === 'co-first' ? 'melville-street-two-bedroom' : 'howe-street-one-bedroom';
  const propertyTitle = signingOrder === 'co-first' ? 'West End Two Bedroom' : 'Bright Downtown One Bedroom';
  await page.goto(`/client/apply/${propertySlug}`);
  await page.getByLabel('Email', { exact: true }).fill('client@example.test');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in securely' }).click();
  await page.getByRole('button', { name: 'Start or continue application' }).click();
  await expect(page).toHaveURL(/\/client\/applications\/[0-9a-f-]+$/);
  const id = page.url().split('/').pop()!;
  const origin = new URL(page.url()).origin;
  const draft = applicationDraftSchema.parse({
    personal: { legalFirstName: 'Primary', legalLastName: 'Applicant', phone: '6045550100', email: 'client@example.test' },
    tenancy: { desiredMoveInDate: '2026-12-01', adultCount: 2, childCount: 0, leaseTerm: 'one_year', needsShowing: 'no' },
    housing: { currentAddress: 'Primary private address', currentHousingSince: '2024-01', currentMonthlyRent: 2200, landlordName: 'Test Landlord', landlordPhone: '6045550101', reasonForLeaving: 'Fictional test move' },
    employment: { employmentStatus: 'employed', employerOrIncomeSource: 'Primary Test Company', occupation: 'Manager', employmentSince: '2020-01', grossMonthlyIncome: 8000, contactName: 'Test Boss', contactPhone: '6045550102' },
    references: { primary: { name: 'Test Reference', relationship: 'Colleague', phone: '6045550103' } }, emergency: { name: 'Test Emergency', relationship: 'Sibling', phone: '6045550104' },
    documentExplanations: { rental_payment_history: 'Fictional test explanation', employment_income_proof: 'Fictional test explanation' }
  });
  const saved = await page.request.patch(`/api/client/applications/${id}/draft`, { headers: { origin }, data: { draft, activeStep: 7 } });
  expect(saved.ok()).toBe(true);
  await page.reload();
  await page.getByRole('button', { name: /STEP 7 Documents/i }).click();
  await page.getByLabel('Choose Credit score report file').setInputFiles(pdf('wrong-primary-credit.pdf'));
  const primaryRemove = page.getByRole('button', { name: 'Remove wrong-primary-credit.pdf', exact: true });
  await expect(primaryRemove).toBeVisible();
  page.once('dialog', dialog => dialog.dismiss());
  await primaryRemove.click();
  await expect(primaryRemove).toBeVisible();
  // A failed removal retains the row and shows an error, so the user can retry.
  await page.route('**/api/client/applications/*/files/*', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Test removal unavailable' } }) }));
  page.once('dialog', dialog => dialog.accept());
  await primaryRemove.click();
  await expect(page.getByText('Test removal unavailable', { exact: true })).toBeVisible();
  await expect(primaryRemove).toBeVisible();
  await page.unroute('**/api/client/applications/*/files/*');
  page.once('dialog', dialog => dialog.accept());
  await primaryRemove.click();
  await expect(primaryRemove).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: /STEP 7 Documents/i }).click();
  await expect(page.getByRole('button', { name: 'Remove wrong-primary-credit.pdf', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Save and continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Income and credit score verification', exact: true })).toBeVisible();
  await page.getByLabel('Choose Credit score report file').setInputFiles(pdf('primary-credit.pdf'));
  await expect(page.getByText('primary-credit.pdf', { exact: true })).toBeVisible();
  await page.getByLabel('I confirm that I voluntarily provide this credit score report for assessment of my rental application.').check();
  await page.getByRole('button', { name: 'Save and continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review and submit', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Add co-applicant' }).click();
  await page.getByLabel('Legal name', { exact: false }).first().fill('Second');
  await page.locator('#co-applicant-email').fill('second@example.test');
  const invitationResponse = page.waitForResponse(response => response.url().endsWith(`/applications/${id}/applicants`) && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Send secure invitation' }).click();
  const invitation = await (await invitationResponse).json();
  expect(invitation.data.invitationId).toBeTruthy();
  expect(invitation.data).not.toHaveProperty('invitationToken');
  if (signingOrder === 'primary-first') {
    await page.getByLabel(/I authorize the property manager/).check();
    await page.getByLabel(/I consent to reference, housing and income verification/).check();
    await page.getByLabel('Type your full legal name to sign *').fill('Primary Applicant');
    await page.getByRole('button', { name: 'Submit application', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Waiting for co-applicants', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add co-applicant', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Revoke access', exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Download submission receipt' })).toHaveCount(0);
    await mkdir('.tmp/joint-form-qa', { recursive: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: '.tmp/joint-form-qa/primary-waiting-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: '.tmp/joint-form-qa/primary-waiting-mobile.png', fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Waiting for co-applicants', exact: true })).toBeVisible();
  }

  const otherContext = await browser.newContext();
  const second = await otherContext.newPage();
  second.setDefaultTimeout(10_000);
  await second.goto(`${origin}/client/invitations?invitation=${invitation.data.invitationId}`);
  await second.getByRole('link', { name: 'Sign in to accept' }).click();
  await second.getByLabel('Email', { exact: true }).fill('second@example.test');
  await second.getByLabel('Password', { exact: true }).fill(password);
  await second.getByRole('button', { name: 'Sign in securely' }).click();
  await second.getByRole('button', { name: 'Accept invitation', exact: true }).click();
  await second.getByLabel('Legal last name *', { exact: true }).fill('Applicant');
  await second.getByLabel('Phone number *', { exact: true }).fill('6045550198');
  await second.getByRole('button', { name: 'Save and continue', exact: true }).click();
  await expect(second.getByRole('heading', { name: 'Shared household and tenancy', exact: true })).toBeVisible();
  await expect(second.getByRole('spinbutton', { name: 'Adults *' })).toHaveCount(0);
  await expect(second.getByText('2026-12-01', { exact: true })).toBeVisible();
  await second.getByRole('button', { name: 'Save and continue', exact: true }).click();
  await second.getByLabel('Current address *', { exact: true }).fill('Second private address');
  await second.getByLabel('Living there since *', { exact: true }).fill('2024-01');
  await second.getByLabel('Current monthly rent (CAD) *', { exact: true }).fill('2100');
  await second.getByLabel('Landlord or housing contact *', { exact: true }).fill('Second Test Landlord');
  await second.getByLabel('Contact phone *', { exact: true }).fill('6045550197');
  await second.getByLabel('Reason for leaving *', { exact: true }).fill('Fictional test move');
  await second.getByRole('combobox', { name: /^Employment status/ }).selectOption('employed');
  await second.getByLabel('Employer or income source *', { exact: true }).fill('Second Test Company');
  await second.getByLabel('Occupation or current role *', { exact: true }).fill('Designer');
  await second.getByLabel('In this role since *', { exact: true }).fill('2020-01');
  await second.getByLabel('Gross monthly income (CAD) *', { exact: true }).fill('7000');
  await second.getByLabel('Verification contact name *', { exact: true }).fill('Test Manager');
  await second.getByLabel('Verification contact phone *', { exact: true }).fill('6045550196');
  await second.getByRole('button', { name: 'Save and continue', exact: true }).click();
  const ref = second.getByRole('group', { name: 'Primary reference' });
  await ref.getByLabel('Name *', { exact: true }).fill('Test Reference');
  await ref.getByLabel('Relationship *', { exact: true }).fill('Manager');
  await ref.getByLabel('Phone *', { exact: true }).fill('6045550195');
  await second.getByLabel('Contact name *', { exact: true }).fill('Test Emergency');
  await second.getByLabel('Relationship *', { exact: true }).last().fill('Sibling');
  await second.getByLabel('Phone number *', { exact: true }).fill('6045550194');
  await second.getByRole('button', { name: 'Save and continue', exact: true }).click();
  await second.getByLabel('Choose Credit score report file').setInputFiles(pdf('wrong-second-credit.pdf'));
  const guestRemove = second.getByRole('button', { name: 'Remove wrong-second-credit.pdf', exact: true });
  await expect(guestRemove).toBeVisible();
  await second.setViewportSize({ width: 390, height: 844 });
  await mkdir('.tmp/file-removal-qa', { recursive: true });
  await second.screenshot({ path: `.tmp/file-removal-qa/${signingOrder}-remove-mobile.png`, fullPage: true });
  second.once('dialog', dialog => dialog.accept());
  await guestRemove.click();
  await expect(guestRemove).toHaveCount(0);
  await second.goto(`${origin}/application/guest`);
  await second.getByRole('button', { name: '5 Documents', exact: true }).click();
  await expect(second.getByRole('button', { name: 'Remove wrong-second-credit.pdf', exact: true })).toHaveCount(0);
  await second.getByRole('button', { name: 'Save and continue', exact: true }).click();
  await expect(second.getByRole('heading', { name: 'Your verification documents', exact: true })).toBeVisible();
  await second.setViewportSize({ width: 1280, height: 900 });
  await second.getByLabel('Choose Credit score report file').setInputFiles(pdf('second-credit.pdf'));
  await expect(second.getByText('second-credit.pdf', { exact: true })).toBeVisible();
  await second.getByRole('button', { name: 'Save and continue', exact: true }).click();
  await expect(second.getByRole('heading', { name: 'Your verification documents', exact: true })).toBeVisible();
  await expect(second.getByLabel('I confirm that I voluntarily provide this credit score report for assessment of my rental application.')).not.toBeChecked();
  await second.getByLabel('I confirm that I voluntarily provide this credit score report for assessment of my rental application.').check();
  await second.getByRole('button', { name: 'Save and continue', exact: true }).click();
  await second.getByLabel(/I authorize the property manager/).check();
  await second.getByLabel(/I consent to reference, housing and income verification/).check();
  await second.getByLabel('Type your full legal name to sign *').fill('Second Applicant');
  await second.getByRole('button', { name: 'Sign my application', exact: true }).click();
  await expect(second.getByRole('heading', { level: 1, name: 'Your part of the application is complete', exact: true })).toBeVisible();
  await second.goto(`${origin}/client/applications`);
  await second.locator('.client-application-card').filter({ hasText: `Reference ${id}` }).getByRole('link', { name: 'View my part of joint application' }).click();
  await expect(second.getByRole('heading', { level: 1, name: 'Your part of the application is complete', exact: true })).toBeVisible();

  if (signingOrder === 'co-first') {
  await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
  await expect(page.getByText('1 of 1 co-applicants signed.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add co-applicant', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: /Step 2 Household & tenancy/i }).click();
  await expect(page.getByLabel('Adults *', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: /Step 3 Housing history/i }).click();
  await page.getByLabel('Current address *', { exact: true }).fill('Primary private address completed after co signed');
  await page.getByRole('button', { name: 'Save and continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Employment and income', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Step 7 Documents/i }).click();
  await page.getByLabel('Choose Recent pay stubs or current employment contract file').setInputFiles(pdf('primary-income-after-co-signed.pdf'));
  await expect(page.getByText('primary-income-after-co-signed.pdf', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save and continue', exact: true }).click();
  await page.getByLabel(/I authorize the property manager/).check();
  await page.getByLabel(/I consent to reference, housing and income verification/).check();
  await page.getByLabel('Type your full legal name to sign *').fill('Primary Applicant');
  await page.getByRole('button', { name: 'Submit application', exact: true }).click();
  } else {
    // The primary may already receive a refreshed server render after the co-applicant signs.
    // Reload verifies the final persisted state without racing a disappearing waiting-screen button.
    await page.reload();
  }
  await expect(page.getByRole('link', { name: 'Download submission receipt' })).toBeVisible();
  await page.goto('/admin');
  await page.getByLabel('Email', { exact: true }).fill('admin@example.test');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/properties$/);
  await page.setViewportSize({ width: 1440, height: 1400 });
  await page.goto(`/admin/applications?application=${id}`);
  const dialog = page.getByRole('dialog', { name: propertyTitle });
  await expect(dialog).toBeVisible();
  const tabs = dialog.getByRole('tablist', { name: 'Choose applicant' });
  const primaryTab = tabs.getByRole('tab', { name: 'Primary Applicant Primary applicant', exact: true });
  const secondTab = tabs.getByRole('tab', { name: 'Second Applicant Co-applicant', exact: true });
  await expect(tabs.getByRole('tab')).toHaveCount(2);
  await expect(primaryTab).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.locator('.joint-tenancy-summary')).toContainText('2 occupants');
  const panel = dialog.getByRole('tabpanel');
  await expect(panel.getByRole('article')).toHaveCount(1);
  await expect(panel.getByRole('heading', { name: 'Personal details', exact: true })).toBeVisible();
  await expect(panel).toContainText(signingOrder === 'co-first' ? 'Primary private address completed after co signed' : 'Primary private address');
  await expect(panel).not.toContainText('Second private address');
  await expect(panel.getByText('primary-credit.pdf', { exact: true })).toHaveCount(1);
  await expect(panel.getByRole('heading', { name: 'Signed declaration', exact: true })).toBeVisible();
  await expect(panel.getByText(/Full signed terms/)).toHaveCount(1);
  await expect(dialog.getByRole('button', { name: 'View applicant details →' })).toHaveCount(0);
  await secondTab.click();
  await expect(secondTab).toHaveAttribute('aria-selected', 'true');
  await expect(panel.getByRole('article', { name: 'Second Applicant application', exact: true })).toBeVisible();
  await expect(panel).toContainText('Second private address');
  await expect(panel).not.toContainText('Primary private address');
  await expect(panel.getByText('primary-credit.pdf', { exact: true })).toHaveCount(0);
  await expect(panel.locator('.joint-report-confirmation')).toHaveCount(1);
  await expect(panel.getByRole('region', { name: 'Second Applicant signed declaration', exact: true })).toBeVisible();
  await secondTab.press('Home');
  await expect(primaryTab).toBeFocused();
  await expect(primaryTab).toHaveAttribute('aria-selected', 'true');
  await expect(panel).toContainText('Primary private address');
  await mkdir('.gstack/qa-reports/applicant-tabs', { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: '.gstack/qa-reports/applicant-tabs/two-applicants-desktop.png', fullPage: false });
  await page.setViewportSize({ width: 390, height: 844 });
  await secondTab.click();
  await expect(panel.getByRole('heading', { name: 'Personal details', exact: true })).toBeVisible();
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: '.gstack/qa-reports/applicant-tabs/two-applicants-mobile.png', fullPage: false });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(dialog.getByRole('button', { name: 'Mark received', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Request information', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Mark cleared', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Start review', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Start review', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Approve & email client', exact: true })).toBeEnabled();
  await expect(dialog.locator('.joint-applicant-card')).toHaveCount(1);
  await expect(secondTab).toHaveAttribute('aria-selected', 'true');
  await otherContext.close();
});
}

test('three, four and five applicants use one detail panel with keyboard and mobile switching', async ({ page, browser }) => {
  test.setTimeout(90_000);
  await page.goto('/client/apply/howe-street-one-bedroom');
  await page.getByLabel('Email', { exact: true }).fill('second@example.test');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in securely' }).click();
  await page.getByRole('button', { name: 'Start or continue application' }).click();
  await expect(page).toHaveURL(/\/client\/applications\/[0-9a-f-]+$/);
  const id = page.url().split('/').pop()!;
  const origin = new URL(page.url()).origin;
  const saved = await page.request.patch(`/api/client/applications/${id}/draft`, { headers: { origin }, data: { draft: applicationDraftSchema.parse({ tenancy: { adultCount: 5, childCount: 0 } }), activeStep: 2 } });
  expect(saved.ok()).toBe(true);
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await adminPage.setViewportSize({ width: 1440, height: 1000 });
  await adminPage.goto(`${origin}/admin/login`);
  await adminPage.getByLabel('Email', { exact: true }).fill('admin@example.test');
  await adminPage.getByLabel('Password', { exact: true }).fill(password);
  await adminPage.getByRole('button', { name: 'Sign In', exact: true }).click();
  await expect(adminPage).toHaveURL(/\/admin\/properties$/);
  for (let number = 1; number <= 4; number++) {
    const invitation = await page.request.post(`/api/client/applications/${id}/applicants`, { headers: { origin }, data: { legalName: `Co Applicant ${number}`, email: `co-${number}@example.test` } });
    expect(invitation.ok()).toBe(true);
    if (number < 2) continue;
    await adminPage.goto(`${origin}/admin/applications?application=${id}`);
    const dialog = adminPage.getByRole('dialog', { name: 'Bright Downtown One Bedroom' });
    const tabs = dialog.getByRole('tablist', { name: 'Choose applicant' });
    const primary = tabs.getByRole('tab', { name: /Primary applicant/ });
    await expect(tabs.getByRole('tab')).toHaveCount(number + 1);
    await expect(primary).toHaveAttribute('aria-selected', 'true');
    const last = tabs.getByRole('tab', { name: `Co Applicant ${number} Co-applicant`, exact: true });
    const backgroundScroll = await adminPage.evaluate(() => window.scrollY);
    await primary.press('End');
    expect(await adminPage.evaluate(() => window.scrollY)).toBe(backgroundScroll);
    await expect(last).toBeFocused();
    await expect(last).toHaveAttribute('aria-selected', 'true');
    await expect(dialog.getByRole('tabpanel').getByRole('article')).toHaveCount(1);
    await expect(dialog.getByRole('tabpanel').getByRole('heading', { name: `Co Applicant ${number}`, exact: true })).toBeVisible();
    await last.press('ArrowRight');
    await expect(primary).toBeFocused();
    if (number === 4) {
      await mkdir('.gstack/qa-reports/applicant-tabs', { recursive: true });
      await adminPage.setViewportSize({ width: 1440, height: 1000 });
      await adminPage.screenshot({ path: '.gstack/qa-reports/applicant-tabs/five-applicants-desktop.png', fullPage: false });
      await adminPage.setViewportSize({ width: 390, height: 844 });
      await primary.press('End');
      await expect(last).toBeInViewport({ ratio: 1 });
      expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      await adminPage.screenshot({ path: '.gstack/qa-reports/applicant-tabs/five-applicants-mobile.png', fullPage: false });
    }
  }
  await adminContext.close();
});

test('Admin idle expiration automatically signs out an open page', async ({ page }) => {
  await page.clock.install();
  await page.goto('/admin/login');
  await page.getByLabel('Email', { exact: true }).fill('admin@example.test');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/properties$/);
  await expect.poll(async () => {
    const response = await page.request.get('/api/auth/activity');
    return (await response.json()).data?.expired;
  }).toBe(false);
  await page.clock.fastForward(60 * 60 * 1000 + 1000);
  await expect(page).toHaveURL(/\/admin\/login\?error=session_expired$/);
  await expect(page.getByText('Your session expired. Sign in again to continue.')).toBeVisible();
});
