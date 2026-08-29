import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

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
      termsVersion: "2026-08-08.1",
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

test("co-applicant exchanges the invitation without creating an account and signs on the website", async ({ page }) => {
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
  await expect(page).toHaveURL(/\/application\/guest$/);
  await expect(page.getByRole("heading", { level: 1, name: "Bright Downtown One Bedroom" })).toBeVisible();
  await expect(page.getByText("No account or password is required.")).toBeVisible();

  await page.getByRole("button", { name: /Review & sign/ }).click();
  await page.getByLabel(/I authorize the property manager/).check();
  await page.getByLabel(/I consent to the stated credit-score/).check();
  await page.getByLabel("Type your full legal name to sign *").fill("Jordan Lee");

  const results = await new AxeBuilder({ page })
    .include(".guest-application-main")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(results.violations.map(({ id }) => id)).toEqual([]);

  await page.getByRole("button", { name: "Sign my application" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Your part of the application is complete" })).toBeVisible();
  expect(signPayload).toMatchObject({
    signatureLegalName: "Jordan Lee",
    sharingAuthorization: true,
    screeningConsent: true,
    termsVersion: "2026-08-08.1",
    formVersion: "2026-07-31.1"
  });
});

test("expired guest invitation shows a clear recovery path", async ({ page }) => {
  await page.route("**/api/application-guests/session", (route) => route.fulfill({
    status: 410,
    contentType: "application/json",
    body: JSON.stringify({ error: { message: "Invitation expired." } })
  }));

  await page.goto("/application/guest#token=expired-token");
  await expect(page).toHaveURL(/\/application\/guest$/);
  await expect(page.getByRole("heading", { level: 1, name: "We cannot open this invitation" })).toBeVisible();
  await expect(page.getByText(/Ask the primary applicant to send a new invitation/)).toBeVisible();
});

test("guest invitation token is removed before a failed exchange request", async ({ page }) => {
  await page.route("**/api/application-guests/session", (route) => route.abort("failed"));

  await page.goto("/");
  await page.goto("/application/guest#token=network-failure-secret");
  await expect(page).toHaveURL(/\/application\/guest$/);
  await expect(page.getByRole("heading", { level: 1, name: "We cannot open this invitation" })).toBeVisible();
  await expect(page.getByText(/Check your connection and try again/)).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/application\/guest$/);
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
  await expect(page.getByRole("heading", { level: 1, name: "Bright Downtown One Bedroom" })).toBeVisible();
  await expect(page.getByLabel("Legal first name *")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
