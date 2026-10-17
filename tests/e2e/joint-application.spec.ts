import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { applicationDraftSchema } from '../../src/features/applications/schemas';

const password = 'test-admin-password';
const pdf = (name: string) => ({ name, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n% FICTIONAL TEST ONLY\n%%EOF') });

test('two verified User accounts accept, upload, personally confirm, sign and appear together for Admin', async ({ page, browser }) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(10_000);
  await page.goto('/client/apply/melville-street-two-bedroom');
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
  await page.getByLabel('Choose Credit score report file').setInputFiles(pdf('primary-credit.pdf'));
  await expect(page.getByText('primary-credit.pdf', { exact: true })).toBeVisible();
  await page.getByLabel('I confirm that I voluntarily provide this credit score report for assessment of my rental application.').check();
  await page.getByRole('button', { name: 'Save and continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review and submit', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Add co-applicant' }).click();
  await page.getByLabel('Legal name', { exact: false }).first().fill('Second Applicant');
  await page.locator('#co-applicant-email').fill('second@example.test');
  const invitationResponse = page.waitForResponse(response => response.url().endsWith(`/applications/${id}/applicants`) && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Send secure invitation' }).click();
  const invitation = await (await invitationResponse).json();
  expect(invitation.data.invitationId).toBeTruthy();
  expect(invitation.data).not.toHaveProperty('invitationToken');
  const otherContext = await browser.newContext();
  const second = await otherContext.newPage();
  second.setDefaultTimeout(10_000);
  await second.goto(`${origin}/client/invitations?invitation=${invitation.data.invitationId}`);
  await second.getByRole('link', { name: 'Sign in to accept' }).click();
  await second.getByLabel('Email', { exact: true }).fill('second@example.test');
  await second.getByLabel('Password', { exact: true }).fill(password);
  await second.getByRole('button', { name: 'Sign in securely' }).click();
  await second.getByRole('button', { name: 'Accept invitation', exact: true }).click();
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
  for (const [label, name] of [
    ['Rental payment history from current landlord','second-rent.pdf'], ['Credit score report','second-credit.pdf'], ['Recent pay stubs or current employment contract','second-income.pdf']
  ]) {
    await second.getByLabel(`Choose ${label} file`).setInputFiles(pdf(name));
    await expect(second.getByText(name, { exact: true })).toBeVisible();
  }
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
  await second.getByRole('link', { name: 'View my part of joint application' }).click();
  await expect(second.getByRole('heading', { level: 1, name: 'Your part of the application is complete', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
  await expect(page.getByText('1 of 1 co-applicants signed.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Step 3 Housing history/i }).click();
  await page.getByLabel('Current address *', { exact: true }).fill('Primary private address completed after co signed');
  await page.getByRole('button', { name: 'Save and continue', exact: true }).click();
  await page.getByRole('button', { name: /Step 7 Documents/i }).click();
  await page.getByLabel('Choose Recent pay stubs or current employment contract file').setInputFiles(pdf('primary-income-after-co-signed.pdf'));
  await expect(page.getByText('primary-income-after-co-signed.pdf', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save and continue', exact: true }).click();
  await page.getByLabel(/I authorize the property manager/).check();
  await page.getByLabel(/I consent to reference, housing and income verification/).check();
  await page.getByLabel('Type your full legal name to sign *').fill('Primary Applicant');
  await page.getByRole('button', { name: 'Submit application', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Download submission receipt' })).toBeVisible();
  await page.goto('/admin');
  await page.getByLabel('Email', { exact: true }).fill('admin@example.test');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/properties$/);
  await page.goto(`/admin/applications?application=${id}`);
  const dialog = page.getByRole('dialog', { name: 'Primary Applicant & Second Applicant' });
  await expect(dialog).toBeVisible();
  const cards = dialog.locator('.joint-applicant-card');
  await expect(cards).toHaveCount(2);
  await expect(cards.getByRole('link', { name: 'View user ↗' })).toHaveCount(2);
  await expect(dialog.getByText('2 occupants', { exact: true })).toBeVisible();
  await expect(cards.getByText(/Voluntarily provided by/)).toHaveCount(2);
  await cards.filter({ hasText: 'Second Applicant' }).getByRole('button', { name: 'View applicant details →' }).click();
  await expect(dialog.getByRole('region', { name: 'Second Applicant details' })).toContainText('Second private address');
  await expect(dialog.getByRole('region', { name: 'Second Applicant details' })).not.toContainText('Primary private address');
  await dialog.getByRole('button', { name: 'Close details' }).click();
  await mkdir('.gstack/qa-reports/joint-application-20261015', { recursive: true });
  await page.screenshot({ path: '.gstack/qa-reports/joint-application-20261015/admin-joint.png', fullPage: true });
  await expect(dialog.getByRole('button', { name: 'Mark received', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Request information', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Mark cleared', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Start review', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Start review', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Approve & email client', exact: true })).toBeEnabled();
  await expect(dialog.locator('.joint-applicant-card')).toHaveCount(2);
  await otherContext.close();
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
