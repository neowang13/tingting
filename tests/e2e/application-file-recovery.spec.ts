import { expect, test } from '@playwright/test';

test('reconnect and focus synchronize attachments without changing unsaved answers', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/client/login');
  await page.getByLabel('Email', { exact: true }).fill('client@example.test');
  await page.getByLabel('Password', { exact: true }).fill('test-admin-password');
  await page.getByRole('button', { name: 'Sign in securely', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  const id = '30000000-0000-4000-8000-000000000009';
  const endpoint = `/api/client/applications/${id}/files`;
  await page.goto(`/client/applications/${id}`);
  await page.getByRole('button', { name: /Step 7 Documents/i }).click();
  const explanation = page.getByLabel('Explain why you cannot provide Rental payment history from current landlord', { exact: true });
  await explanation.fill('Unsaved answers must survive reconnecting and switching tabs.');
  for (const event of ['online', 'focus']) {
    const name = `fictional-${event}.pdf`;
    await page.getByLabel('Choose Other supporting document (if needed) file').setInputFiles({ name, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\n% FICTIONAL TEST ONLY\n%%EOF') });
    const remove = page.getByRole('button', { name: `Remove ${name}`, exact: true });
    await expect(remove).toBeVisible();
    const files = (await (await page.request.get(endpoint)).json()).data.files as Array<{ id: string; originalFilename: string }>;
    const file = files.find(file => file.originalFilename === name)!;
    // Another tab has already removed the object. Repeated requests are safe.
    const options = { headers: { origin: new URL(page.url()).origin } };
    expect((await page.request.delete(`${endpoint}/${file.id}`, options)).status()).toBe(200);
    expect((await page.request.delete(`${endpoint}/${file.id}`, options)).status()).toBe(200);
    await page.evaluate(event => window.dispatchEvent(new Event(event)), event);
    await expect(remove).toHaveCount(0);
    await expect(explanation).toHaveValue('Unsaved answers must survive reconnecting and switching tabs.');
  }
});
