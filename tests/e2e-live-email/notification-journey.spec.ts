import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test.use({ actionTimeout: 15_000 });

// Explicit opt-in lives in playwright.email.config.ts. Never runs in ordinary mock E2E.
test('visitor books a viewing and sends a real notification', async ({ page, request }) => {
  const recipient = process.env.E2E_EMAIL_RECIPIENT!;
  const run = `E2E-${Date.now()}`;
  const startedAt = Date.now();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const health = await (await request.get('/api/health')).json();
  expect(health.data).toMatchObject({ backend: 'memory-demo', emailProviderMode: 'live', smsProviderMode: 'mock' });

  // The disposable server starts with closed calendars. Open only the test property's dates.
  const origin = test.info().project.use.baseURL!;
  const login = await request.post('/api/auth/login', { headers: { origin }, data: { email: 'admin@example.test', password: 'test-admin-password' } });
  expect(login.ok()).toBe(true);
  const schedulePath = '/api/admin/rentals/20000000-0000-4000-8000-000000000001/viewing-schedule';
  const schedule = await (await request.get(schedulePath)).json();
  const opened = await request.patch(schedulePath, { headers: { origin }, data: {
    timezone: 'America/Vancouver', openWeekdays: [1, 2, 3, 4, 5, 6, 7], dateOverrides: [], expectedUpdatedAt: schedule.data.updatedAt
  } });
  expect(opened.ok()).toBe(true);

  await page.goto('/rentals/howe-street-one-bedroom');
  await page.getByRole('button', { name: 'Book a viewing' }).click();
  const dialog = page.getByRole('dialog', { name: 'Choose a date to view this home' });
  await expect(dialog).toBeVisible();
  const availability = await (await request.get('/api/public/showings?propertySlug=howe-street-one-bedroom')).json();
  const date = availability.data.dates[0].date;
  const dateLabel = new Intl.DateTimeFormat('en-CA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
  const calendar = dialog.getByRole('group', { name: 'Choose a viewing date', exact: true });
  const dateButton = calendar.getByRole('button', { name: dateLabel, exact: true });
  if (await dateButton.count() === 0) await calendar.getByRole('button', { name: 'Next month', exact: true }).click();
  await dateButton.click();
  await dialog.getByLabel('Name *').fill(`${run} Test Visitor`);
  await dialog.getByLabel('Phone number *').fill('604-555-0198');
  await dialog.getByLabel('Email address *').fill(recipient);
  const booked = page.waitForResponse(r => r.url().endsWith('/api/public/showings') && r.request().method() === 'POST');
  await dialog.getByRole('button', { name: 'Book this viewing' }).click();
  const bookingResponse = await booked;
  expect(bookingResponse.status()).toBe(202);
  const booking = (await bookingResponse.json()).data;
  await expect(dialog.getByText(/Viewing date registered/)).toBeVisible();
  await mkdir('/private/tmp/tingting-flow-qa', { recursive: true });
  await page.screenshot({ path: '/private/tmp/tingting-flow-qa/viewing-confirmation.png', fullPage: true });
  await writeFile('/private/tmp/tingting-flow-qa/viewing-result.json', JSON.stringify({ run, startedAt, recipient, requestId: booking.requestId, date }, null, 2));
  expect(errors).toEqual([]);
});

test('client completes an application with files and sends a real notification', async ({ page }) => {
  const recipient = process.env.E2E_EMAIL_RECIPIENT!;
  const run = `E2E-${Date.now()}`;
  const startedAt = Date.now();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await mkdir('/private/tmp/tingting-flow-qa', { recursive: true });
  await page.goto('/client/apply/melville-street-two-bedroom');
  await expect(page).toHaveURL(/\/client\/login/);
  await page.getByLabel('Email', { exact: true }).fill('client@example.test');
  await page.getByLabel('Password', { exact: true }).fill('test-admin-password');
  await page.getByRole('button', { name: 'Sign in securely' }).click();
  await expect(page).toHaveURL(/\/client\/apply\/melville-street-two-bedroom$/);
  await page.getByRole('button', { name: 'Start or continue application' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'West End Two Bedroom' })).toBeVisible();
  await expect(page).toHaveURL(/\/client\/applications\/[0-9a-f-]+$/);
  const applicationId = page.url().split('/').pop()!;
  console.info('Application opened');

  await page.getByLabel('Legal first name *').fill(run);
  await page.getByLabel('Legal last name *').fill('Test Applicant');
  await page.getByLabel('Phone number *').fill('604-555-0198');
  await page.getByLabel('Email address *').fill(recipient);
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page.getByRole('heading', { name: 'Household and tenancy request', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Legal first name *')).toHaveValue(run);
  await page.getByRole('button', { name: 'Save and continue' }).click();

  await page.getByLabel('Desired move-in date *').fill('2026-12-01');
  await page.getByLabel('Preferred lease term *').selectOption('one_year');
  await page.getByLabel('Adults *').fill('1');
  await page.getByLabel('Children *').fill('0');
  await page.getByLabel('Do you still need a showing? *').selectOption('no');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await page.getByLabel('Current address *').fill('123 Fictional Test Street, Vancouver');
  await page.getByLabel('Living there since *').fill('2024-01');
  await page.getByLabel('Current monthly rent (CAD) *').fill('2200');
  await page.getByLabel('Landlord or housing contact *').fill('Fictional Test Landlord');
  await page.getByLabel('Contact phone *').fill('604-555-0197');
  await page.getByLabel('Reason for leaving *').fill('Automated test only. This is not a real application.');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await page.getByLabel('Employment status *').selectOption('employed');
  await page.getByLabel('Employer or income source *').fill('Fictional Test Company');
  await page.getByLabel('Occupation or current role *').fill('Test role');
  await page.getByLabel('In this role since *').fill('2022-06');
  await page.getByLabel('Gross monthly income (CAD) *').fill('7200');
  await page.getByLabel('Verification contact name *').fill('Fictional Test Manager');
  await page.getByLabel('Verification contact phone *').fill('604-555-0196');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  const reference = page.getByRole('group', { name: 'Primary reference' });
  await reference.getByLabel('Name *').fill('Fictional Test Reference');
  await reference.getByLabel('Relationship *').fill('Former manager');
  await reference.getByLabel('Phone *').fill('604-555-0195');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await page.getByLabel('Contact name *').fill('Fictional Test Contact');
  await page.getByLabel('Relationship *').fill('Sibling');
  await page.getByLabel('Phone number *').fill('604-555-0194');
  await page.getByRole('button', { name: 'Save and continue' }).click();

  console.info('Application fields completed');
  for (const [label, name] of [
    ['Rental payment history from current landlord', 'test-rental-history.pdf'],
    ['Credit score report', 'test-credit-report.pdf'],
    ['Recent pay stubs or current employment contract', 'test-pay-stub.pdf']
  ]) {
    const uploaded = page.waitForResponse(response => response.url().endsWith(`/applications/${applicationId}/files`) && response.request().method() === 'POST');
    await page.getByLabel(`Choose ${label} file`).setInputFiles({ name, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n% FICTIONAL E2E TEST DOCUMENT ONLY\n%%EOF') });
    const uploadResponse = await uploaded;
    expect(uploadResponse.status(), await uploadResponse.text()).toBe(201);
    await expect(page.locator('.application-file-list').getByText(name, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save and continue' })).toBeEnabled();
  }
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await page.getByLabel(/I authorize the property manager/).check();
  await page.getByLabel(/I consent to the stated credit-score/).check();
  await page.getByLabel('Type your full legal name to sign *').fill(`${run} Test Applicant`);
  console.info('Supporting files uploaded');
  const submitted = page.waitForResponse(r => r.url().endsWith(`/applications/${applicationId}/submit`) && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Submit application' }).click();
  const submittedResponse = await submitted;
  expect(submittedResponse.status()).toBe(202);
  const application = (await submittedResponse.json()).data;
  expect(application.status).toBe('submitted');
  expect(application.files).toHaveLength(3);
  await expect(page.getByRole('link', { name: 'Download submission receipt' })).toBeVisible();
  await page.screenshot({ path: '/private/tmp/tingting-flow-qa/application-submitted.png', fullPage: true });
  const receipt = await page.request.get(`/api/client/applications/${applicationId}/receipt`);
  expect(receipt.ok()).toBe(true);

  console.info('Application submitted');
  await page.goto('/admin');
  await page.getByLabel('Email', { exact: true }).fill('admin@example.test');
  await page.getByLabel('Password', { exact: true }).fill('test-admin-password');
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Properties' })).toBeVisible();
  await page.goto('/admin/applications');
  await page.getByRole('button', { name: 'Review application' }).click();
  const review = page.getByRole('dialog', { name: `${run} Test Applicant` });
  await expect(review).toBeVisible();
  for (const name of ['test-rental-history.pdf', 'test-credit-report.pdf', 'test-pay-stub.pdf']) await expect(review.getByText(name, { exact: true })).toBeVisible();
  const mailHeaders = { authorization: `Bearer ${process.env.RESEND_API_KEY}` };
  const mailResponse = await fetch('https://api.resend.com/emails?limit=30', { headers: mailHeaders });
  expect(mailResponse.ok).toBe(true);
  const mailList = await mailResponse.json();
  const applicationMail = mailList.data.find((mail: { subject: string; to: string[] }) => mail.to.includes(recipient) && mail.subject.includes(run));
  expect(applicationMail, 'The real provider must have the submitted application email').toBeTruthy();
  const detailsResponse = await fetch(`https://api.resend.com/emails/${applicationMail.id}`, { headers: mailHeaders });
  expect(detailsResponse.ok).toBe(true);
  const mailDetails = await detailsResponse.json();
  expect(mailDetails.text).toContain(applicationId);
  expect(mailDetails.text).toContain('test-pay-stub.pdf');
  expect(mailDetails.text).toContain('Fictional Test Company');
  await writeFile('/private/tmp/tingting-flow-qa/result.json', JSON.stringify({ run, startedAt, recipient, applicationId, applicationStatus: application.status, uploadedFiles: application.files.length, applicationEmailId: applicationMail.id, pageErrors: errors }, null, 2));
  expect(errors).toEqual([]);
});
