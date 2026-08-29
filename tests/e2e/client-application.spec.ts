import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("client login, explanation-only application, affirmative consent, receipt, and staff queue", async ({ page, request }) => {
  test.setTimeout(60_000);

  const denied = await request.get("/api/client/applications/30000000-0000-4000-8000-000000000009/paper-form");
  expect(denied.status()).toBe(401);

  await page.goto("/client/applications");
  await expect(page).toHaveURL(/\/client\/login\?next=%2Fclient%2Fapplications$/);
  await page.getByLabel("Email").fill("client@example.test");
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await expect(page.locator(".client-auth-card .form-status.error")).toContainText("incorrect");

  await page.getByLabel("Password").fill("test-admin-password");
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "My applications" })).toBeVisible();
  await expect(page.getByText("Bright Downtown One Bedroom")).toBeVisible();
  await page.getByRole("link", { name: "Continue application" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Bright Downtown One Bedroom" })).toBeVisible();

  await page.getByLabel("Legal first name *").fill("Demo");
  await page.getByLabel("Legal last name *").fill("Applicant");
  await page.getByLabel("Phone number *").fill("604-555-0182");
  await page.getByLabel("Email address *").fill("client@example.test");
  await page.getByText("Prefer a paper application?").click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download fillable paper application" }).click();
  expect((await downloadPromise).suggestedFilename()).toBe("remax-application-for-tenancy-fillable.pdf");
  await page.getByRole("button", { name: "Save and continue" }).click();

  await page.getByLabel("Desired move-in date *").fill("2026-09-01");
  await page.getByLabel("Preferred lease term *").selectOption("one_year");
  await page.getByLabel("Adults *").fill("2");
  await page.getByLabel("Children *").fill("1");
  await page.getByLabel("Do you still need a showing? *").selectOption("no");
  await expect(page.getByLabel("Why does this home fit your needs? (optional)")).not.toHaveAttribute("required", "");
  await page.getByRole("button", { name: "Save and continue" }).click();

  await page.getByLabel("Current address *").fill("10 Current Street, Vancouver");
  await page.getByLabel("Living there since *").fill("2024-01");
  await page.getByLabel("Current monthly rent (CAD) *").fill("2200");
  await page.getByLabel("Landlord or housing contact *").fill("Current Landlord");
  await page.getByLabel("Contact phone *").fill("604-555-0111");
  await page.getByLabel("Reason for leaving *").fill("Need a different location.");
  await page.getByRole("button", { name: "Save and continue" }).click();

  await page.getByLabel("Employment status *").selectOption("employed");
  await page.getByLabel("Employer or income source *").fill("Example Company");
  await page.getByLabel("Occupation or current role *").fill("Designer");
  await page.getByLabel("In this role since *").fill("2022-06");
  await page.getByLabel("Gross monthly income (CAD) *").fill("7200");
  await page.getByLabel("Verification contact name *").fill("Manager Name");
  await page.getByLabel("Verification contact phone *").fill("604-555-0122");
  await page.getByRole("button", { name: "Save and continue" }).click();

  await page.getByRole("group", { name: "Primary reference" }).getByLabel("Name *").fill("Reference Person");
  await page.getByRole("group", { name: "Primary reference" }).getByLabel("Relationship *").fill("Former manager");
  await page.getByRole("group", { name: "Primary reference" }).getByLabel("Phone *").fill("604-555-0133");
  await page.getByRole("button", { name: "Save and continue" }).click();

  await page.getByLabel("Contact name *").fill("Emergency Person");
  await page.getByLabel("Relationship *").fill("Sibling");
  await page.getByLabel("Phone number *").fill("604-555-0144");
  await page.getByRole("button", { name: "Save and continue" }).click();

  await page.getByLabel("Choose Recent pay stubs or current employment contract file").setInputFiles({
    name: "unsafe.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7\n/OpenAction /JavaScript")
  });
  await expect(page.locator(".client-application-flow .form-status.error")).toContainText("scripts");

  await page.getByLabel("Explain why you cannot provide Rental payment history from current landlord").fill("My landlord cannot provide a rental payment history.");
  await page.getByLabel("Explain why you cannot provide Credit score report").fill("I cannot access a current credit score report.");
  await page.getByLabel("Explain why you cannot provide Recent pay stubs or current employment contract").fill("My employment documents are not currently available.");
  await expect(page.getByText(
    "Providing an explanation does not replace supporting evidence. If we cannot verify your information, your application may be declined."
  ).first()).toBeVisible();
  await expect(page.getByText(
    "If you cannot provide recent pay stubs, you must upload a recent bank statement."
  )).toBeVisible();

  const documentStepResults = await new AxeBuilder({ page })
    .include(".client-application-flow")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(documentStepResults.violations.map(({ id }) => id)).toEqual([]);

  await page.getByRole("button", { name: "Save and continue" }).click();
  const householdReview = page.locator(".application-review-group").filter({ hasText: "Household & tenancy" });
  await expect(householdReview).toContainText("Adults2");
  await expect(householdReview).toContainText("Children1");
  await expect(householdReview).toContainText("Total occupants3");
  const documentReview = page.locator(".application-review-group").filter({ hasText: "Income and credit score verification" });
  await expect(documentReview).toContainText("My landlord cannot provide a rental payment history.");
  const sharing = page.getByLabel(/I authorize the property manager/);
  const screening = page.getByLabel(/I consent to the stated credit-score/);
  await expect(sharing).not.toBeChecked();
  await expect(screening).not.toBeChecked();

  await sharing.check();
  await screening.check();
  await page.getByLabel("Type your full legal name to sign *").fill("Demo Applicant");
  await page.getByRole("button", { name: "Submit application" }).click();
  await expect(page.getByRole("link", { name: "Download submission receipt" })).toBeVisible();
  await expect(page.getByText("Submitted", { exact: true }).first()).toBeVisible();

  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(results.violations.map(({ id }) => id)).toEqual([]);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/client\/login$/);

  await page.goto("/admin");
  await page.getByLabel("Email").fill("admin@example.test");
  await page.getByLabel("Password").fill("test-admin-password");
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Properties" })).toBeVisible();
  await page.goto("/admin/applications");
  await expect(page.getByRole("heading", { level: 1, name: "Client applications" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Review application" })).toBeVisible();
  await page.getByRole("button", { name: "Review application" }).click();
  const reviewDialog = page.getByRole("dialog", { name: "Demo Applicant" });
  await expect(reviewDialog).toBeVisible();
  const requestedTenancy = reviewDialog.locator(".application-detail-card").filter({ hasText: "Requested tenancy" });
  await expect(requestedTenancy).toContainText("Adults2");
  await expect(requestedTenancy).toContainText("Children1");
  await expect(requestedTenancy).toContainText("Total occupants3");
  await expect(reviewDialog.getByText("No files to screen. Review the applicant explanations below.")).toBeVisible();
  await expect(reviewDialog.getByText("My employment documents are not currently available.")).toBeVisible();
  await page.getByRole("button", { name: "Mark received" }).click();
  await expect(page.getByRole("button", { name: "Start review" })).toBeVisible();
  await page.getByRole("button", { name: "Start review" }).click();
  await expect(page.getByRole("button", { name: "Approve & email client" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Decline" })).toBeVisible();
  await page.getByRole("button", { name: "Approve & email client" }).click();
  await expect(reviewDialog.getByText(/approval email was queued/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark as tenant" })).toBeVisible();
  await page.getByRole("button", { name: "Mark as tenant" }).click();
  const createTenant = reviewDialog.getByRole("button", { name: "Create & link tenant" });
  await expect(createTenant).toBeDisabled();
  await reviewDialog.getByLabel("Choose signed tenancy agreement PDF").setInputFiles({
    name: "signed-tenancy-agreement.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF")
  });
  await expect(reviewDialog.getByText("Signed tenancy agreement uploaded to private storage.")).toBeVisible();
  await expect(reviewDialog.getByText("signed-tenancy-agreement.pdf")).toBeVisible();
  await reviewDialog.getByLabel("Lease end date").fill("2027-08-31");
  await reviewDialog.getByLabel(/I confirm the tenancy agreement has been signed/).check();
  await expect(createTenant).toBeEnabled();
  await createTenant.click();
  await expect(reviewDialog.getByText("Tenant created and linked to this Client account.")).toBeVisible();
  await expect(reviewDialog.getByRole("link", { name: "Manage tenant" })).toBeVisible();

  const modalResults = await new AxeBuilder({ page })
    .include(".application-review-dialog")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(modalResults.violations.map(({ id }) => id)).toEqual([]);
});
