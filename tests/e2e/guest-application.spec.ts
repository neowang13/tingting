import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const completeDraft = {
  personal: {
    legalFirstName: "Jordan",
    legalLastName: "Lee",
    phone: "604-555-0118",
    alternatePhone: "",
    email: "jordan@example.test"
  },
  tenancy: {
    desiredMoveInDate: "2026-10-01",
    leaseTerm: "one_year",
    occupantCount: 2,
    adultCount: 2,
    childCount: 0,
    hasPets: false,
    petDetails: "",
    needsParking: false,
    needsShowing: "no",
    reasonForChoosing: ""
  },
  housing: {
    currentAddress: "12 Current Street, Vancouver",
    currentHousingSince: "2024-01",
    currentMonthlyRent: 2200,
    landlordName: "Current Landlord",
    landlordPhone: "604-555-0142",
    reasonForLeaving: "Moving closer to work."
  },
  employment: {
    employmentStatus: "employed",
    employerOrIncomeSource: "Example Company",
    occupation: "Designer",
    employmentSince: "2022-04",
    grossMonthlyIncome: 7000,
    contactName: "Manager Name",
    contactPhone: "604-555-0153"
  },
  references: {
    primary: { name: "Reference Person", relationship: "Manager", phone: "604-555-0164", email: "" },
    secondary: { name: "", relationship: "", phone: "", email: "" }
  },
  emergency: {
    name: "Emergency Person",
    relationship: "Sibling",
    phone: "604-555-0175",
    email: ""
  },
  documentExplanations: {
    rental_payment_history: "My landlord cannot provide rental payment records.",
    credit_score_report: "I cannot access a current credit report right now.",
    employment_income_proof: "My employer will verify my income by telephone."
  }
};

function bootstrap(status: "in_progress" | "signed" = "in_progress") {
  return {
    application: {
      id: "30000000-0000-4000-8000-000000000009",
      propertyTitle: "Bright Downtown One Bedroom",
      propertyAddress: "123 Example Street, Vancouver",
      formVersion: "2026-07-31.1",
      formSha256: "a".repeat(64),
      termsVersion: "2026-10-15.1",
      termsSha256: "b".repeat(64),
      termsText: "Application collection and consent notice\n\nYour information is used only to assess this application."
    },
    applicant: {
      id: "40000000-0000-4000-8000-000000000001",
      legalName: "Jordan Lee",
      email: "jordan@example.test",
      status,
      draft: completeDraft,
      draftUpdatedAt: "2026-08-26T18:00:00.000Z",
      files: [],
      signedAt: status === "signed" ? "2026-08-26T18:30:00.000Z" : null
    }
  };
}

test.beforeEach(async ({ page }) => {
  await page.goto('/client/login?next=%2Fclient%2Fapplications');
  await page.getByLabel('Email', { exact: true }).fill('second@example.test');
  await page.getByLabel('Password', { exact: true }).fill('test-admin-password');
  await page.getByRole('button', { name: 'Sign in securely' }).click();
  await expect(page).toHaveURL(/\/client\/applications$/);
});

test("co-applicant steps stay compact, use the entered legal name, and require only the credit document category", async ({ page }) => {
  const fixture = bootstrap();
  fixture.applicant.legalName = "Jordan";
  fixture.applicant.draft = { ...completeDraft, documentExplanations: {
    rental_payment_history: "", employment_income_proof: "", credit_score_report: ""
  } };
  await page.route("**/api/application-guests/session", route => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ data: fixture })
  }));
  await page.route("**/api/application-guests/draft", route => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ data: { draftUpdatedAt: new Date().toISOString() } })
  }));
  await page.goto("/application/guest#token=compact-steps");
  await page.getByRole("button", { name: "Accept invitation", exact: true }).click();
  await page.getByLabel("Legal last name *", { exact: true }).fill("Wang");

  for (const step of ["1 Personal", "2 Tenancy", "3 Housing & income"]) {
    await page.getByRole("button", { name: step, exact: true }).click();
    const nav = await page.getByRole("navigation", { name: "Application progress" }).boundingBox();
    const panel = await page.locator(".guest-form-panel").boundingBox();
    expect(nav).not.toBeNull(); expect(panel).not.toBeNull();
    expect(nav!.height).toBeLessThan(130);
    expect(panel!.y - (nav!.y + nav!.height)).toBeGreaterThanOrEqual(16);
    expect(panel!.y - (nav!.y + nav!.height)).toBeLessThanOrEqual(24);
    expect(panel!.y).toBeLessThan(300);
  }
  await mkdir(".tmp/joint-form-qa", { recursive: true });
  await page.screenshot({ path: ".tmp/joint-form-qa/desktop.png", fullPage: true });

  await page.getByRole("button", { name: "5 Documents", exact: true }).click();
  const categories = page.locator(".application-document-category");
  await expect(categories.filter({ hasText: "Rental payment history from current landlord" }).getByText("Optional", { exact: true })).toBeVisible();
  await expect(categories.filter({ hasText: "Recent pay stubs or current employment contract" }).getByText("Optional", { exact: true })).toBeVisible();
  await expect(categories.filter({ hasText: "Credit score report" }).getByText("Required", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: /Explain why/ })).toHaveCount(1);
  await page.getByRole("button", { name: "Save and continue", exact: true }).click();
  await expect(page.locator(".form-status[role=alert]").filter({ hasText: /Upload credit score report/ })).toBeVisible();
  await page.getByLabel("Explain why you cannot provide Credit score report").fill("A current credit report is not available for this test.");
  await page.getByRole("button", { name: "Save and continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review and sign", exact: true })).toBeVisible();
  await expect(page.getByText("Enter your legal name as shown above: Jordan Wang", { exact: true })).toBeVisible();
  await expect(page.getByLabel(/I authorize the property manager/)).not.toBeChecked();
  await expect(page.getByLabel(/I consent to reference, housing and income verification/)).not.toBeChecked();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "1 Personal", exact: true }).click();
  await expect(page.getByLabel("Legal last name *", { exact: true })).toHaveValue("Wang");
  const mobileNav = await page.getByRole("navigation", { name: "Application progress" }).boundingBox();
  const mobilePanel = await page.locator(".guest-form-panel").boundingBox();
  expect(mobileNav!.height).toBeLessThan(130);
  expect(mobilePanel!.y - (mobileNav!.y + mobileNav!.height)).toBeLessThanOrEqual(24);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: ".tmp/joint-form-qa/mobile.png", fullPage: true });
});

test("signed-in co-applicant accepts the invitation and signs their own information", async ({ page }) => {
  let signPayload: Record<string, unknown> | null = null;

  await page.route("**/api/application-guests/session", async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(await route.request().postDataJSON()).toEqual({ token: "one-time-token" });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: bootstrap() }) });
  });
  await page.route("**/api/application-guests/draft", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { draftUpdatedAt: "2026-08-26T18:25:00.000Z" } }) });
  });
  await page.route("**/api/application-guests/sign", async (route) => {
    signPayload = await route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { applicant: bootstrap("signed").applicant } }) });
  });

  await page.goto("/application/guest#token=one-time-token");
  await page.getByRole("button", { name: "Accept invitation", exact: true }).click();
  await expect(page).toHaveURL(/\/client\/invitations$/);
  await expect(page.getByRole("heading", { level: 1, name: "Bright Downtown One Bedroom" })).toBeVisible();


  await page.getByRole("button", { name: /Review & sign/ }).click();
  await page.getByLabel(/I authorize the property manager/).check();
  await page.getByLabel(/I consent to reference, housing and income verification/).check();
  await page.getByLabel("Type your full legal name to sign *").fill("Jordan Lee");

  const results = await new AxeBuilder({ page })
    .include(".guest-application-main")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(results.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map(node => ({ html: node.html, summary: node.failureSummary })) }))).toEqual([]);

  await page.getByRole("button", { name: "Sign my application" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Your part of the application is complete" })).toBeVisible();
  expect(signPayload).toMatchObject({
    signatureLegalName: "Jordan Lee",
    sharingAuthorization: true,
    screeningConsent: true,
    termsVersion: "2026-10-15.1",
    formVersion: "2026-07-31.1"
  });
});

test("a changed shared tenancy must be reviewed before the co-applicant can sign", async ({ page }) => {
  const currentDraft = { ...completeDraft, tenancy: { ...completeDraft.tenancy, adultCount: 3, occupantCount: 3, desiredMoveInDate: "2026-12-15" } };
  let signatureRequests = 0;
  await page.route("**/api/application-guests/session", route => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ data: bootstrap() })
  }));
  await page.route("**/api/application-guests/draft", route => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ data: { draft: currentDraft, draftUpdatedAt: new Date().toISOString() } })
  }));
  await page.route("**/api/application-guests/sign", route => {
    signatureRequests++;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { applicant: { ...bootstrap("signed").applicant, draft: currentDraft } } }) });
  });
  await page.goto("/application/guest#token=changed-tenancy");
  await page.getByRole("button", { name: "Accept invitation", exact: true }).click();
  await page.getByRole("button", { name: /Review & sign/ }).click();
  await page.getByLabel(/I authorize the property manager/).check();
  await page.getByLabel(/I consent to reference, housing and income verification/).check();
  await page.getByLabel("Type your full legal name to sign *").fill("Jordan Lee");
  await page.getByRole("button", { name: "Sign my application", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Shared household and tenancy", exact: true })).toBeVisible();
  await expect(page.locator(".form-status[role=alert]")).toContainText("Review the current household and tenancy details");
  await expect(page.getByText("2026-12-15", { exact: true })).toBeVisible();
  await expect(page.getByText("3 / 0", { exact: true })).toBeVisible();
  expect(signatureRequests).toBe(0);
  await page.getByRole("button", { name: "Save and continue", exact: true }).click();
  await page.getByRole("button", { name: /Review & sign/ }).click();
  await page.getByLabel(/I authorize the property manager/).check();
  await page.getByLabel(/I consent to reference, housing and income verification/).check();
  await page.getByLabel("Type your full legal name to sign *").fill("Jordan Lee");
  await page.getByRole("button", { name: "Sign my application", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your part of the application is complete", exact: true })).toBeVisible();
  expect(signatureRequests).toBe(1);
});

test("expired guest invitation shows a clear recovery path", async ({ page }) => {
  await page.route("**/api/application-guests/session", (route) => route.fulfill({
    status: 410,
    contentType: "application/json",
    body: JSON.stringify({ error: { message: "Invitation expired." } })
  }));

  await page.goto("/application/guest#token=expired-token");
  await page.getByRole("button", { name: "Accept invitation", exact: true }).click();
  await expect(page).toHaveURL(/\/client\/invitations$/);
  await expect(page.locator(".form-status[role=alert]")).toBeVisible();
  await expect(page.getByText(/Ask the primary applicant to send a new invitation/)).toBeVisible();
});

test("guest invitation token is removed before a failed exchange request", async ({ page }) => {
  await page.route("**/api/application-guests/session", (route) => route.abort("failed"));

  await page.goto("/");
  await page.goto("/application/guest#token=network-failure-secret");
  await page.getByRole("button", { name: "Accept invitation", exact: true }).click();
  await expect(page).toHaveURL(/\/client\/invitations$/);
  await expect(page.locator(".form-status[role=alert]")).toBeVisible();
  await expect(page.getByText(/Check your connection and try again/)).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/client\/invitations$/);
  expect(page.url()).not.toContain("network-failure-secret");
});

test("guest application remains usable on a narrow mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/application-guests/session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ data: bootstrap() })
  }));

  await page.goto("/application/guest#token=mobile-token");
  await page.getByRole("button", { name: "Accept invitation", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Bright Downtown One Bedroom" })).toBeVisible();
  await expect(page.getByLabel("Legal first name *")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
