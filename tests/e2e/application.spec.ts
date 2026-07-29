import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function expectNoSeriousAccessibilityViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    results.violations.map(({ id, impact, nodes }) => ({
      id,
      impact,
      targets: nodes.map((node) => node.target)
    }))
  ).toEqual([]);
}

function pngBuffer(width = 800, height = 600) {
  const buffer = Buffer.alloc(24);
  buffer.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

test("public search, rental detail, validation, responsive layout, and accessibility", async ({ page }) => {
  const consoleErrors: string[] = [];
  const failedResponses: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`);
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Find Your Perfect Rental" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "Rental Management" })).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);

  for (const viewport of [
    { width: 375, height: 812 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 }
  ]) {
    await page.setViewportSize(viewport);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)
    ).toBe(true);
  }

  const servicePages = [
    ["/services/renovation", "Renovations Designed Around Your Home."],
    ["/services/handyman-service", "Reliable Help for the Small Jobs Around Your Home."],
    ["/services/property-maintenance", "Ongoing Care to Keep Your Property in Great Condition."],
    ["/services/strata-service", "Practical Support for Strata Property Needs."],
    ["/services/rental-management", "Hassle-Free Management. Happy Tenants."]
  ] as const;
  for (const [path, heading] of servicePages) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(page.locator(".service-offering")).toHaveCount(4);
    await expect(page.getByText("OUR PROCESS", { exact: true })).toHaveCount(0);
    await expect(page.getByText("FREQUENTLY ASKED QUESTIONS", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Call 604-872-6896" }).first())
      .toHaveAttribute("href", "tel:+16048726896");
  }

  await page.getByRole("button", { name: "Contact us", exact: true }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const dialogBox = await dialog.boundingBox();
  const viewport = page.viewportSize();
  expect(dialogBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(Math.abs((dialogBox!.x + dialogBox!.width / 2) - viewport!.width / 2)).toBeLessThan(3);
  expect(Math.abs((dialogBox!.y + dialogBox!.height / 2) - viewport!.height / 2)).toBeLessThan(3);
  await page.getByRole("button", { name: "Close contact form" }).click();

  await page.goto("/");
  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("navigation", { name: "Mobile navigation" })).toBeVisible();
  await page.getByRole("button", { name: "Close navigation" }).click();

  await page.getByLabel("Location", { exact: true }).fill("Downtown");
  await page.getByLabel("Beds", { exact: true }).selectOption("1");
  await page.getByRole("button", { name: "Search Rentals", exact: true }).click();
  await expect(page).toHaveURL(/\/rentals\?location=Downtown&beds=1$/);
  await expect(page.getByRole("heading", { name: "Bright Downtown One Bedroom" })).toBeVisible();
  await page.getByRole("link", { name: "View rental →" }).click();
  await expect(page).toHaveURL(/\/rentals\/howe-street-one-bedroom$/);
  await expect(page.getByRole("button", { name: "Book a viewing" })).toBeVisible();

  await page.goto("/#contact");
  await page.getByRole("button", { name: "Send Message" }).click();
  await expect(page.locator("#contact-name")).toBeFocused();
  expect(await page.locator("#contact-name").evaluate((element) => element.matches(":invalid"))).toBe(true);
  expect(await page.locator("#contact-message").evaluate((element) => element.matches(":invalid"))).toBe(true);

  await page.goto("/");
  await page.keyboard.press("Tab");
  const firstFocusedTag = await page.evaluate(() => document.activeElement?.tagName);
  expect(firstFocusedTag).toBe("A");
  expect(consoleErrors).toEqual([]);
  expect(failedResponses).toEqual([]);
});

test("admin modules, fixed content editor, logout, and accessibility", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login$/);
  await page.getByLabel("Email").fill("admin@example.test");
  await page.getByLabel("Password").fill("test-admin-password");
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);

  const routes = [
    ["/admin/content", "Website content"],
    ["/admin/rentals", "Rental listings"],
    ["/admin/tenants", "Tenants & schedules"],
    ["/admin/notifications/templates", "Email templates"],
    ["/admin/notifications/history", "Email activity"],
    ["/admin/automation", "Automation & imports"],
    ["/admin/automation/service-accounts", "Service accounts"],
    ["/admin/automation/imports", "Import history"],
    ["/admin/automation/audit", "Automation audit"],
    ["/admin/settings", "Reminder settings"]
  ] as const;
  for (const [path, heading] of routes) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)
    ).toBe(true);
  }

  await page.goto("/admin/content");
  await expect(page.getByRole("columnheader", { name: "Appears on" })).toHaveCount(3);
  await expect(page.getByText("Edit → Save draft → Preview → Publish")).toBeVisible();
  await expect(page.getByText("rental_search", { exact: true })).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)
  ).toBe(true);
  await page.locator("details.admin-mobile-navigation > summary").click();
  await expect(page.locator("details.admin-mobile-navigation nav")).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto("/admin/rentals/new");
  const rentalImageCards = page.locator(".rental-images > .media-grid > .media-card");
  const existingMediaCount = await rentalImageCards.count();
  await page.locator("details.media-library > summary").click();
  await page.getByLabel("Image files").setInputFiles([
    { name: "living-room.png", mimeType: "image/png", buffer: pngBuffer() },
    { name: "kitchen.png", mimeType: "image/png", buffer: pngBuffer(900, 700) }
  ]);
  await expect(page.locator(".media-upload-preview")).toHaveCount(2);
  await expect(page.getByText("living-room.png", { exact: true })).toBeVisible();
  await expect(page.getByText("kitchen.png", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Upload 2 images" }).click();
  await expect(page.getByText("2 images uploaded as private drafts.")).toBeVisible();
  await expect(rentalImageCards).toHaveCount(existingMediaCount + 2);

  await page.getByLabel("Listing title").fill("E2E Rental Listing");
  await page.getByLabel("Street address").fill("100 Test Street");
  await page.getByLabel("Monthly rent (CAD)").fill("2500");
  await page.getByLabel("Listing description").fill("A browser-only regression test rental.");
  const rentalSave = page.waitForResponse(
    (response) => response.url().endsWith("/api/admin/rentals") && response.request().method() === "POST"
  );
  await page.getByRole("button", { name: "Save privately" }).click();
  expect((await rentalSave).status()).toBe(201);
  await expect(page).toHaveURL(/\/admin\/rentals\/[0-9a-f-]+$/);
  await expect(page.getByLabel("URL slug")).toHaveValue("e2e-rental-listing");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Publish to website" }).click();
  await expect(
    page.getByText("This draft is saved, but it is not ready to publish.")
  ).toBeVisible();
  await page.getByLabel("Postal code").fill("V6B 1A1");
  await page.getByLabel("Available now").check();
  await page.getByLabel("Furnishing").selectOption("unfurnished");
  await page.getByLabel("Lease type").selectOption("fixed_term");
  await page.getByLabel("No smoking").check();
  await page.getByLabel("Not allowed").check();
  await page.getByLabel("Use image").first().check();
  await page.getByLabel("Cover image").first().check();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Publish to website" }).click();
  await expect(page.getByText("Published. This rental is now live on the website.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove from website" })).toBeVisible();

  await page.goto("/admin/content/hero");
  await expect(page.getByRole("heading", { level: 1, name: "Homepage introduction" })).toBeVisible();
  await expect(page.getByLabel("Main heading", { exact: true })).toHaveValue("Find Your Perfect Rental");
  await expect(page.getByRole("button", { name: "Save without publishing" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish to website" })).toBeVisible();
  await page.getByLabel("Main heading", { exact: true }).fill("Published Directly From Admin");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Publish to website" }).click();
  await expect(page.getByText("Published. The public website now shows these changes.")).toBeVisible();
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Published Directly From Admin" })).toBeVisible();

  await page.goto("/admin/content/property_services");
  await expect(page.getByRole("group", { name: "Rental management" })).toBeVisible();
  await expect(page.locator('input[value="Rental Management"]')).toBeVisible();

  await page.goto("/admin/tenants/new");
  await page.getByLabel("Name", { exact: true }).fill("E2E Reminder Tenant");
  await page.getByLabel("Property").fill("500 Test Avenue");
  await page.getByLabel("Unit").fill("12");
  await page.getByLabel("Move-in date").fill("2026-07-01");
  await page.locator('input[name="email"]').fill("e2e-tenant@example.com");
  await page.locator('input[name="rentDueDay"]').fill("15");
  const tenantSave = page.waitForResponse(
    (response) => response.url().endsWith("/api/admin/tenants") && response.request().method() === "POST"
  );
  await page.getByRole("button", { name: "Save tenant" }).click();
  expect((await tenantSave).status()).toBe(201);
  await expect(page).toHaveURL(/\/admin\/tenants\/[0-9a-f-]+\?saved=tenant$/);
  await expect(page.getByText("Tenant saved. The next email was recalculated, but automatic sending remains paused.")).toBeVisible();

  await page.goto("/admin/settings");
  await expect(page.getByLabel("Business name")).toHaveValue("Ting Ting Xu Real Estate");
  await page.getByLabel("Business name").fill("Ting Ting Property Group");
  await page.getByRole("button", { name: "Save business name" }).click();
  await expect(page.getByText("Business name saved. New email previews and reminders will use it.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Business name")).toHaveValue("Ting Ting Property Group");
  await expect(page.getByRole("heading", { name: "Send a test email" })).toBeVisible();
  await page.getByLabel("Admin test email").fill("admin-test@example.com");
  await page.getByRole("button", { name: "Save test email" }).click();
  await expect(page.getByText("Test email destination saved.")).toBeVisible();
  await page.getByLabel("Email template").selectOption({ label: "Monthly rent reminder" });
  await page.getByLabel("Use sample details from").selectOption({ label: "E2E Reminder Tenant" });
  await page.evaluate(() => {
    Object.defineProperty(globalThis.crypto, "randomUUID", {
      configurable: true,
      value: undefined
    });
  });
  await page.getByRole("button", { name: "Preview test email" }).click();
  await expect(page.getByRole("heading", { name: "Test email preview" })).toBeVisible();
  await page.getByRole("button", { name: /Send test email to/ }).click();
  await expect(page.getByText("Test-mode email recorded. No real email was sent.")).toBeVisible();

  await page.goto("/admin/automation/service-accounts");
  await page.getByLabel("Account name").fill("E2E OpenClaw Operations");
  await page.getByRole("button", { name: "Create service account" }).click();
  await expect(page.getByRole("heading", { name: "Save this token now" })).toBeVisible();
  await expect(page.locator(".token-value")).toContainText("tta_");
  await page.getByLabel("I saved this token in an approved secret store.").check();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.locator(".token-value")).toHaveCount(0);
  await expectNoSeriousAccessibilityViolations(page);

  await page.goto("/admin");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/admin\/login$/);
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
});
