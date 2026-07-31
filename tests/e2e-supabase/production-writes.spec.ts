import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

interface ApiResult<T> {
  status: number;
  body: { success: boolean; data?: T; error?: { code: string; message: string } };
}

interface Versioned {
  updatedAt: string;
}

function decodeBase32(value: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = value.toUpperCase().replace(/[\s=-]/g, "");
  let bits = "";
  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("TEST_ADMIN_TOTP_SECRET is not valid base32.");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  }
  return Buffer.from(bytes);
}

function currentTotp(secret: string, now = Date.now()) {
  const counter = Math.floor(now / 30_000);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", decodeBase32(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

async function adminApi<T>(
  page: Page,
  path: string,
  method: "GET" | "POST" | "PATCH" = "GET",
  payload?: unknown
): Promise<ApiResult<T>> {
  return page.evaluate(
    async ({ requestPath, requestMethod, requestPayload }) => {
      const response = await fetch(requestPath, {
        method: requestMethod,
        headers: requestPayload === undefined ? undefined : { "content-type": "application/json" },
        body: requestPayload === undefined ? undefined : JSON.stringify(requestPayload),
        credentials: "same-origin"
      });
      return { status: response.status, body: await response.json() };
    },
    { requestPath: path, requestMethod: method, requestPayload: payload }
  );
}

async function uploadTestMedia(page: Page, runId: string) {
  return page.evaluate(async (marker) => {
    const bytes = new Uint8Array(24);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    new DataView(bytes.buffer).setUint32(16, 800);
    new DataView(bytes.buffer).setUint32(20, 600);
    const form = new FormData();
    form.set("file", new File([bytes], `${marker}.png`, { type: "image/png" }));
    form.set("altText", `Synthetic E2E cover ${marker}`);
    const response = await fetch("/api/admin/media", {
      method: "POST",
      body: form,
      credentials: "same-origin"
    });
    return { status: response.status, body: await response.json() };
  }, runId) as Promise<ApiResult<{ id: string }>>;
}

async function uploadTestRentReceipt(page: Page, tenantId: string, period: string, runId: string) {
  return page.evaluate(async ({ targetTenantId, targetPeriod, marker }) => {
    const form = new FormData();
    form.set("tenantId", targetTenantId);
    form.set("period", targetPeriod);
    form.set(
      "file",
      new File(
        [new TextEncoder().encode("%PDF-1.7 synthetic local E2E rent receipt")],
        `${marker}-rent.pdf`,
        { type: "application/pdf" }
      )
    );
    const response = await fetch("/api/admin/rent-payments", {
      method: "POST",
      body: form,
      credentials: "same-origin"
    });
    return { status: response.status, body: await response.json() };
  }, { targetTenantId: tenantId, targetPeriod: period, marker: runId }) as Promise<ApiResult<{
    id: string;
    status: string;
    receiptId: string;
    updatedAt: string;
  }>>;
}

function expectSuccess<T>(result: ApiResult<T>): T {
  expect(result.status, JSON.stringify(result.body)).toBeLessThan(300);
  expect(result.body.success, JSON.stringify(result.body)).toBe(true);
  return result.body.data as T;
}

test("production Cookie authentication covers critical Supabase writes", async ({ page }) => {
  test.skip(
    process.env.E2E_SUPABASE_TEST_PROJECT_CONFIRMED !== "true",
    "A dedicated Supabase test project is required."
  );

  const email = process.env.TEST_ADMIN_EMAIL!;
  const password = process.env.TEST_ADMIN_PASSWORD!;
  const totpSecret = process.env.TEST_ADMIN_TOTP_SECRET!;
  const runId = `e2e-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login/);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page.getByLabel("Six-digit code")).toBeVisible();
  await page.getByLabel("Six-digit code").fill(currentTotp(totpSecret));
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();

  const cookies = await page.context().cookies();
  expect(cookies.some((cookie) => cookie.name.startsWith("sb-") && cookie.name.includes("auth-token"))).toBe(true);
  expect(cookies.some((cookie) => cookie.name === "tt-last-active")).toBe(true);
  expect(cookies.some((cookie) => cookie.name === "tt-session-started")).toBe(true);

  const dashboardRequest = page.waitForRequest(
    (request) => request.url().endsWith("/api/admin/dashboard")
  );
  const dashboard = await adminApi(page, "/api/admin/dashboard");
  expectSuccess(dashboard);
  expect((await dashboardRequest).headers()["authorization"]).toBeUndefined();

  const sectionKey = "footer";
  const section = expectSuccess<Versioned & {
    draftContent: Record<string, unknown>;
    publishedContent: Record<string, unknown>;
  }>(await adminApi(page, `/api/admin/sections/${sectionKey}`));
  const revisions = expectSuccess<Array<{ id: string; content: unknown }>>(
    await adminApi(page, `/api/admin/sections/${sectionKey}/revisions`)
  );
  const originalRevision = revisions.find(
    (revision) => JSON.stringify(revision.content) === JSON.stringify(section.publishedContent)
  );
  expect(originalRevision, "The test project must have a revision for the currently published footer.").toBeTruthy();
  const originalSummary = String(section.publishedContent.summary);
  const changedSummary = `Supabase production E2E ${runId}`;

  const savedDraft = expectSuccess<Versioned>(
    await adminApi(page, `/api/admin/sections/${sectionKey}`, "PATCH", {
      content: { ...section.draftContent, summary: changedSummary },
      expectedVersion: section.updatedAt
    })
  );
  const publicBeforePublish = expectSuccess<{ sections: { footer: { summary: string } } }>(
    await adminApi(page, "/api/public/site")
  );
  expect(publicBeforePublish.sections.footer.summary).toBe(originalSummary);

  const published = expectSuccess<Versioned>(
    await adminApi(page, `/api/admin/sections/${sectionKey}/publish`, "POST", {
      expectedVersion: savedDraft.updatedAt
    })
  );
  const publicAfterPublish = expectSuccess<{ sections: { footer: { summary: string } } }>(
    await adminApi(page, "/api/public/site")
  );
  expect(publicAfterPublish.sections.footer.summary).toBe(changedSummary);

  expectSuccess(
    await adminApi(page, `/api/admin/sections/${sectionKey}/rollback`, "POST", {
      revisionId: originalRevision!.id,
      expectedVersion: published.updatedAt
    })
  );
  const publicAfterRollback = expectSuccess<{ sections: { footer: { summary: string } } }>(
    await adminApi(page, "/api/public/site")
  );
  expect(publicAfterRollback.sections.footer.summary).toBe(originalSummary);

  const coverMedia = expectSuccess(await uploadTestMedia(page, runId));
  const rentalInput = {
    slug: runId,
    title: `Test rental ${runId}`,
    property: {
      id: null,
      expectedVersion: null,
      propertyType: "apartment",
      buildingName: null,
      unitNumber: "T-1",
      streetAddress: "100 Test Only Street",
      neighbourhood: "Test",
      city: "Vancouver",
      provinceCode: "BC",
      postalCode: "V6B 1A1",
      countryCode: "CA"
    },
    pricing: { monthlyRentCents: 250000, currencyCode: "CAD" },
    layout: {
      bedrooms: 1,
      bathrooms: 1,
      denCount: 0,
      squareFeet: 600,
      furnishedStatus: "unfurnished"
    },
    availability: {
      status: "available_now",
      availableOn: null,
      leaseType: "fixed_term",
      minimumLeaseMonths: 12
    },
    parking: {
      available: false,
      type: null,
      stalls: null,
      included: null,
      visitorAvailable: false,
      notes: null
    },
    storage: { available: false, lockers: null, included: null, notes: null },
    pets: {
      status: "not_allowed",
      catsAllowed: false,
      dogsAllowed: false,
      maxCount: null,
      sizeLimitLbs: null,
      notes: null
    },
    smokingPolicy: "not_allowed",
    applicationRequirements: { creditCheckRequired: true, referencesRequired: true },
    amenityCodes: ["balcony", "dishwasher"],
    includedUtilityCodes: ["water"],
    fees: [],
    contact: { mode: "site_default", name: null, email: null, phone: null },
    utilitiesNotes: null,
    amenityNotes: null,
    description: "Dedicated Supabase E2E record. Not a real listing.",
    images: [{ mediaAssetId: coverMedia.id, sortOrder: 0, isCover: true }]
  };
  const rental = expectSuccess<Versioned & {
    id: string;
    status: string;
    property: { id: string; updatedAt: string };
  }>(
    await adminApi(page, "/api/admin/rentals", "POST", rentalInput)
  );
  const updatedRental = expectSuccess<Versioned & { id: string; status: string }>(
    await adminApi(page, `/api/admin/rentals/${rental.id}`, "PATCH", {
      rental: {
        ...rentalInput,
        title: `Updated test rental ${runId}`,
        property: {
          ...rentalInput.property,
          id: rental.property.id,
          expectedVersion: rental.property.updatedAt
        }
      },
      expectedVersion: rental.updatedAt
    })
  );
  const publishedRental = expectSuccess<Versioned & { status: string }>(
    await adminApi(page, `/api/admin/rentals/${rental.id}/publish`, "POST", {
      expectedVersion: updatedRental.updatedAt
    })
  );
  expect(publishedRental.status).toBe("published");
  const unpublishedRental = expectSuccess<Versioned & { status: string }>(
    await adminApi(page, `/api/admin/rentals/${rental.id}/unpublish`, "POST", {
      expectedVersion: publishedRental.updatedAt
    })
  );
  expect(unpublishedRental.status).toBe("draft");
  const archivedRental = expectSuccess<{ status: string }>(
    await adminApi(page, `/api/admin/rentals/${rental.id}/archive`, "POST", {
      expectedVersion: unpublishedRental.updatedAt
    })
  );
  expect(archivedRental.status).toBe("archived");

  const emailTemplate = expectSuccess<{ id: string }>(
    await adminApi(page, "/api/admin/templates", "POST", {
      name: `Email ${runId}`,
      channel: "email",
      subjectTemplate: "Test reminder for {{property}}",
      bodyTemplate: "Hi {{tenant_name}}, test rent is due on {{due_date}}.",
      isActive: true
    })
  );
  const smsTemplate = expectSuccess<{ id: string }>(
    await adminApi(page, "/api/admin/templates", "POST", {
      name: `SMS ${runId}`,
      channel: "sms",
      subjectTemplate: null,
      bodyTemplate: "Hi {{tenant_name}}, test rent is due on {{due_date}}.",
      isActive: true
    })
  );

  const permissionTime = new Date().toISOString();
  const tenantInput = {
    fullName: `Test Tenant ${runId}`,
    propertyLabel: "100 Test Only Street",
    unitLabel: "T-1",
    moveInDate: "2026-07-01",
    leaseType: "month_to_month",
    leaseEndDate: null,
    email: "tenant-e2e@example.test",
    phoneE164: "+16045550199",
    preferredChannels: ["email", "sms"],
    emailContactStatus: "allowed",
    smsContactStatus: "opted_out",
    emailContactStatusReason: "Dedicated test project only",
    smsContactStatusReason: "Intentional skipped-recipient assertion",
    emailContactStatusSource: "e2e",
    smsContactStatusSource: "e2e",
    contactPermissionNote: "Synthetic test data",
    contactPermissionUpdatedAt: permissionTime,
    timezone: "America/Vancouver",
    internalNotes: runId,
    rentDueDay: 1,
    isActive: true
  };
  const tenant = expectSuccess<Versioned & { id: string }>(
    await adminApi(page, "/api/admin/tenants", "POST", tenantInput)
  );
  const updatedTenant = expectSuccess<Versioned & { id: string }>(
    await adminApi(page, `/api/admin/tenants/${tenant.id}`, "PATCH", {
      tenant: {
        ...tenantInput,
        unitLabel: "T-2",
        emailContactStatusReason: "Permission reconfirmed by E2E",
        contactPermissionUpdatedAt: new Date().toISOString()
      },
      expectedVersion: tenant.updatedAt
    })
  );

  const legacyScheduleWrite = await adminApi(page, `/api/admin/tenants/${tenant.id}/schedule`, "POST", {
      schedule: {
        rentDueDay: 1,
        dayOfMonth: 31,
        localTime: "09:00",
        timezone: "America/Vancouver",
        channels: ["email"],
        emailTemplateId: emailTemplate.id,
        smsTemplateId: null,
        isEnabled: true
      },
      expectedVersion: null
    });
  expect(legacyScheduleWrite.status).toBe(409);
  expect(legacyScheduleWrite.body.error?.code).toBe("GLOBAL_REMINDER_POLICY");
  const projectedTenants = expectSuccess<Array<{
    id: string;
    moveInDate: string | null;
    leaseType: string | null;
    scheduleStatus: string;
    nextRunAt: string | null;
    lastDeliveryStatus: string | null;
  }>>(await adminApi(
    page,
    `/api/admin/tenants?q=${encodeURIComponent(runId)}&lifecycle=active&contact=email_allowed&schedule=disabled`
  ));
  expect(projectedTenants).toEqual([
    expect.objectContaining({
      id: tenant.id,
      moveInDate: "2026-07-01",
      leaseType: "month_to_month",
      scheduleStatus: "disabled",
      nextRunAt: null
    })
  ]);

  const collectedRent = expectSuccess(await uploadTestRentReceipt(
    page,
    tenant.id,
    "2026-07",
    runId
  ));
  expect(collectedRent).toMatchObject({
    status: "collected",
    receiptId: expect.any(String)
  });
  const storedRent = expectSuccess<{
    status: string;
    receiptId: string;
    updatedAt: string;
  }>(await adminApi(
    page,
    `/api/admin/rent-payments?tenantId=${tenant.id}&period=2026-07`
  ));
  expect(storedRent).toMatchObject({
    status: "collected",
    receiptId: collectedRent.receiptId
  });
  const receiptLink = expectSuccess<{ url: string; expiresInSeconds: number }>(
    await adminApi(page, `/api/admin/rent-payment-receipts/${collectedRent.receiptId}`)
  );
  expect(receiptLink.url).toContain("/storage/v1/object/sign/tenant-rent-payment-receipts/");
  expect(receiptLink.expiresInSeconds).toBe(300);
  const reopenedRent = expectSuccess<{ status: string; receiptId: string | null }>(
    await adminApi(page, "/api/admin/rent-payments", "PATCH", {
      tenantId: tenant.id,
      period: "2026-07",
      expectedVersion: storedRent.updatedAt,
      reason: "Synthetic E2E correction"
    })
  );
  expect(reopenedRent).toMatchObject({ status: "due", receiptId: null });

  const currentSettings = expectSuccess<{ businessName: string; updatedAt: string }>(
    await adminApi(page, "/api/admin/settings/reminders")
  );
  const updatedSettings = expectSuccess<{ businessName: string; updatedAt: string }>(
    await adminApi(page, "/api/admin/settings/reminders", "PATCH", {
      businessName: `Ting Ting Property Group ${runId}`,
      expectedVersion: currentSettings.updatedAt
    })
  );
  expect(updatedSettings.businessName).toBe(`Ting Ting Property Group ${runId}`);

  const currentTestContacts = expectSuccess<{ updatedAt: string }>(
    await adminApi(page, "/api/admin/settings/test-contacts")
  );
  expectSuccess(await adminApi(page, "/api/admin/settings/test-contacts", "PATCH", {
    email: "admin-owned-e2e@example.test",
    phoneE164: "+16045550101",
    expectedVersion: currentTestContacts.updatedAt
  }));
  const testRequestId = crypto.randomUUID();
  const bypassAttempt = await adminApi(page, "/api/admin/notifications/test", "POST", {
    tenantId: tenant.id,
    channel: "email",
    templateId: emailTemplate.id,
    requestId: testRequestId,
    previewToken: "x".repeat(40)
  });
  expect(bypassAttempt.status).toBe(409);
  expect(bypassAttempt.body.error?.code).toBe("TEST_PREVIEW_REQUIRED");

  const testPreview = expectSuccess<{
    requestId: string;
    previewToken: string;
    destinationMasked: string;
    providerMode: string;
    subject: string;
    body: string;
  }>(await adminApi(page, "/api/admin/notifications/test-preview", "POST", {
    tenantId: tenant.id,
    channel: "email",
    templateId: emailTemplate.id,
    requestId: testRequestId
  }));
  expect(testPreview).toMatchObject({
    destinationMasked: "a***@example.test",
    providerMode: "mock",
    subject: "Test reminder for 100 Test Only Street"
  });
  expect(testPreview.body).toContain("August 1, 2026");
  const testEvent = expectSuccess<{ id: string; source: string; destinationMasked: string }>(
    await adminApi(page, "/api/admin/notifications/test", "POST", {
      tenantId: tenant.id,
      channel: "email",
      templateId: emailTemplate.id,
      requestId: testRequestId,
      previewToken: testPreview.previewToken
    })
  );
  expect(testEvent).toMatchObject({
    source: "test",
    destinationMasked: "a***@example.test"
  });
  const cronResponse = await page.request.post("/api/internal/reminders/run", {
    headers: {
      authorization: `Bearer ${process.env.REMINDER_CRON_SECRET}`
    }
  });
  expect(cronResponse.status(), await cronResponse.text()).toBe(200);
  const dispatchedTests = expectSuccess<Array<{
    id: string;
    status: string;
    provider: string;
    providerStatus: string;
    providerMessageId: string;
    source: string;
  }>>(await adminApi(page, `/api/admin/notifications/events?tenantId=${tenant.id}&channel=email`));
  expect(dispatchedTests).toEqual(expect.arrayContaining([
    expect.objectContaining({
      id: testEvent.id,
      source: "test",
      status: "queued",
      provider: "resend",
      providerStatus: "mock_queued",
      providerMessageId: expect.stringMatching(/^mock-email-/)
    })
  ]));

  const batchPayload = {
    selectionMode: "tenant_ids",
    tenantIds: [tenant.id],
    channels: ["email", "sms"],
    emailTemplateId: emailTemplate.id,
    smsTemplateId: smsTemplate.id,
    requestId: crypto.randomUUID()
  };
  const preview = expectSuccess<{
    selectedCount: number;
    eligibleCount: number;
    skippedCount: number;
    rows: Array<{ channel: string; eligible: boolean; reason: string | null }>;
  }>(await adminApi(page, "/api/admin/notifications/preview", "POST", batchPayload));
  expect(preview).toMatchObject({ selectedCount: 1, eligibleCount: 1, skippedCount: 1 });
  expect(preview.rows).toEqual(expect.arrayContaining([
    expect.objectContaining({ channel: "sms", eligible: false, reason: "SMS is not permitted" })
  ]));

  const batch = expectSuccess<{ id: string; eligibleCount: number; status: string }>(
    await adminApi(page, "/api/admin/notifications/batches", "POST", batchPayload)
  );
  expect(batch).toMatchObject({ eligibleCount: 1, status: "draft" });

  const service = createClient(
    process.env.TEST_SUPABASE_URL!,
    process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const frozen = await service
    .from("notification_batch_recipients")
    .select("channel,eligibility_status,skip_reason,destination_snapshot")
    .eq("batch_id", batch.id)
    .order("channel");
  expect(frozen.error).toBeNull();
  expect(frozen.data).toEqual([
    expect.objectContaining({
      channel: "email",
      eligibility_status: "eligible",
      destination_snapshot: "tenant-e2e@example.test"
    }),
    expect.objectContaining({
      channel: "sms",
      eligibility_status: "skipped",
      skip_reason: "sms_not_allowed"
    })
  ]);

  const confirmed = expectSuccess<{ status: string; eligibleCount: number }>(
    await adminApi(page, `/api/admin/notifications/batches/${batch.id}/confirm`, "POST", {
      confirmationIdempotencyKey: `confirm-${runId}`,
      acknowledgedRecipientCount: preview.eligibleCount
    })
  );
  expect(confirmed).toMatchObject({ status: "confirmed", eligibleCount: 1 });

  const event = await service
    .from("notification_events")
    .select("id,source,channel,status,provider,batch_id")
    .eq("batch_id", batch.id)
    .single();
  expect(event.error).toBeNull();
  expect(event.data).toMatchObject({
    source: "manual",
    channel: "email",
    status: "scheduled",
    provider: "resend"
  });
  const scheduledDate = new Date().toISOString().slice(0, 10);
  const filteredEvents = expectSuccess<Array<{ id: string; tenantId: string; channel: string; status: string }>>(
    await adminApi(
      page,
      `/api/admin/notifications/events?tenantId=${tenant.id}&channel=email&status=scheduled&start=${scheduledDate}&end=${scheduledDate}`
    )
  );
  expect(filteredEvents).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: event.data!.id, tenantId: tenant.id, channel: "email", status: "scheduled" })
  ]));

  const audit = await service
    .from("audit_events")
    .select("action,target_id")
    .in("action", [
      "section.published",
      "section.rolled_back",
      "rental.v2.saved",
      "tenant.created",
      "rent.receipt.registered",
      "rent.payment.collected",
      "rent.payment.reopened",
      "notification.batch_created",
      "notification.batch_confirmed",
      "auth.login_succeeded",
      "auth.mfa_challenge_succeeded"
    ])
    .order("created_at", { ascending: false })
    .limit(100);
  expect(audit.error).toBeNull();
  expect(audit.data?.map((row) => row.action)).toEqual(expect.arrayContaining([
    "section.published",
    "section.rolled_back",
    "rental.v2.saved",
    "tenant.created",
    "rent.receipt.registered",
    "rent.payment.collected",
    "rent.payment.reopened",
    "notification.batch_created",
    "notification.batch_confirmed",
    "auth.login_succeeded",
    "auth.mfa_challenge_succeeded"
  ]));

  const archivedTenant = expectSuccess<{ isActive: boolean; archivedAt: string | null }>(
    await adminApi(page, `/api/admin/tenants/${tenant.id}/archive`, "POST", {
      expectedVersion: updatedTenant.updatedAt
    })
  );
  expect(archivedTenant.isActive).toBe(false);
  expect(archivedTenant.archivedAt).toBeTruthy();
});
