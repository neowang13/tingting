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

test("public homepage, rental search, rental detail, validation, responsive layout, and accessibility", async ({ page }) => {
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
  await expect(page.getByRole("search")).toHaveCount(0);
  await expect(page.getByLabel("Location", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 3, name: "Rental Management" })).toBeVisible();
  await expect(page.getByText(
    "Tenant placement, rent collection, inspections, and day-to-day coordination."
  )).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "Trade Services" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "Property Management" })).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 3, name: "Handyman Services" })).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 3, name: "Property Maintenance" })).toHaveCount(0);
  await expect(page.locator(".service-card").first()).toContainText("Rental Management");
  const tingTingPortrait = page.getByAltText("Real estate professional Ting Ting Xu");
  await tingTingPortrait.scrollIntoViewIfNeeded();
  await expect(tingTingPortrait).toBeVisible();
  await expect(tingTingPortrait).toHaveAttribute("src", /ting-ting-xu-portrait\.jpg/);
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
    ["/services/trade-services", "A Clear First Step for Property Projects."],
    ["/services/property-care", "One-Time Fixes and Ongoing Property Upkeep."],
    ["/services/strata-service", "Practical Support for Strata Property Needs."],
    ["/services/rental-management", "Rental Management for Homes and Commercial Properties."]
  ] as const;
  for (const [path, heading] of servicePages) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(page.locator(".service-offering")).toHaveCount(
      path === "/services/property-care" ? 6 : 4
    );
    await expect(page.getByText("OUR PROCESS", { exact: true })).toHaveCount(0);
    await expect(page.getByText("FREQUENTLY ASKED QUESTIONS", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Call 604-872-6896" }).first())
      .toHaveAttribute("href", "tel:+16048726896");
  }
  await page.goto("/services/renovation");
  await expect(page).toHaveURL(/\/services\/trade-services$/);
  await expect(page.getByRole("heading", { level: 1, name: "A Clear First Step for Property Projects." })).toBeVisible();
  for (const legacyPath of ["/services/handyman-service", "/services/property-maintenance"]) {
    await page.goto(legacyPath);
    await expect(page).toHaveURL(/\/services\/property-care$/);
    await expect(page.getByRole("heading", { level: 1, name: "One-Time Fixes and Ongoing Property Upkeep." })).toBeVisible();
  }

  await page.goto("/services/rental-management");
  await expect(page.getByRole("heading", { level: 3, name: "Residential Rental Management" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "Commercial Rental Management" })).toBeVisible();
  await expect(page.getByText("Framework & exclusions", { exact: true })).toHaveCount(2);
  await expect(page.getByText("Escalation path", { exact: true })).toHaveCount(2);
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

  await page.goto("/services/property-care");
  await expect(page.getByRole("heading", { level: 3, name: "One-Time Fixes · Minor Fixture Support" })).toBeVisible();
  await expect(page.getByText(
    "Minor caulking, sealing, fixture, faucet, or drain requests are assessed first; regulated plumbing or electrical work is directed to a qualified trade."
  )).toBeVisible();

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

  await page.goto("/rentals");
  await page.getByLabel("Location", { exact: true }).fill("Downtown");
  await page.getByLabel("Beds", { exact: true }).fill("1");
  await page.getByRole("button", { name: "Apply filters", exact: true }).click();
  await expect(page).toHaveURL(/\/rentals\?location=Downtown.*&beds=1(?:&|$)/);
  await expect(page.getByRole("heading", { name: "Bright Downtown One Bedroom" })).toBeVisible();
  await page.getByRole("link", { name: "View rental →" }).click();
  await expect(page).toHaveURL(/\/rentals\/howe-street-one-bedroom$/);
  await expect(page.getByRole("button", { name: "Book a viewing" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Apply online" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save listing" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ask Ting Ting" })).toHaveCount(0);

  await page.goto("/#contact");
  await page.getByRole("button", { name: "Send Message" }).click();
  await expect(page.locator("#homepage-contact-name")).toBeFocused();
  expect(await page.locator("#homepage-contact-name").evaluate((element) => element.matches(":invalid"))).toBe(true);
  expect(await page.locator("#homepage-contact-message").evaluate((element) => element.matches(":invalid"))).toBe(true);

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
  await expect(page.getByRole("link", { name: "Automation & imports" })).toHaveCount(0);
  await expectNoSeriousAccessibilityViolations(page);

  const routes = [
    ["/admin/content", "Website content"],
    ["/admin/rentals", "Rental listings"],
    ["/admin/clients", "Client accounts"],
    ["/admin/tenants", "Tenants & schedules"],
    ["/admin/notifications/templates", "Email templates"],
    ["/admin/notifications/history", "Email activity"],
    ["/admin/settings", "Reminder settings"]
  ] as const;
  for (const [path, heading] of routes) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)
    ).toBe(true);
  }

  await page.goto("/admin/clients");
  await expect(page.getByText("Matching email addresses are never linked automatically.")).toBeVisible();
  await expect(page.getByText("Verified", { exact: true })).toBeVisible();
  await expect(page.getByText("Not linked", { exact: true })).toBeVisible();
  await page.getByLabel("Tenant for Demo Client").selectOption("30000000-0000-4000-8000-000000000001");
  await page.getByRole("button", { name: "Link tenant" }).click();
  await expect(page.getByRole("link", { name: "Manage tenant" })).toHaveAttribute(
    "href",
    "/admin/tenants/30000000-0000-4000-8000-000000000001"
  );
  await page.getByRole("button", { name: "Unlink" }).click();
  await expect(page.getByText("Not linked", { exact: true })).toBeVisible();

  await page.goto("/admin/content");
  await expect(page.getByText("Edit → Save draft → Preview → Publish")).toBeVisible();
  await expect(page.getByText("rental_search", { exact: true })).toHaveCount(0);
  await expect(page.locator(".content-group").last().locator(".content-section-row").first())
    .toContainText("Residential & commercial rental management");

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

  await page.goto("/admin/content/service_rental_management");
  await page.getByRole("button", { name: "Management types" }).click();
  await expect(page.getByRole("group", { name: "Residential Rental Management" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Commercial Rental Management" })).toBeVisible();
  await expect(page.getByLabel("Framework and exclusions").first()).toHaveValue(/Residential Tenancy Act/);

  await page.goto("/admin/content/service_property_care");
  await page.getByRole("button", { name: "Core services" }).click();
  await expect(
    page.getByRole("group", { name: "Core service 6 of 6" }).getByLabel("Title")
  ).toHaveValue("Ongoing Upkeep · Preventive Property Checks");

  await page.goto("/admin/tenants/new");
  await page.getByLabel("Name", { exact: true }).fill("E2E Reminder Tenant");
  await page.getByLabel("Property").fill("500 Test Avenue");
  await page.getByLabel("Unit").fill("12");
  await page.getByLabel("Lease start date").fill("2026-07-01");
  await page.getByLabel("Lease type").selectOption("month_to_month");
  await page.locator('input[name="email"]').fill("e2e-tenant@example.com");
  await page.locator('input[name="rentDueDay"]').fill("15");
  const tenantSave = page.waitForResponse(
    (response) => response.url().endsWith("/api/admin/tenants") && response.request().method() === "POST"
  );
  await page.getByRole("button", { name: "Save tenant" }).click();
  expect((await tenantSave).status()).toBe(201);
  await expect(page).toHaveURL(/\/admin\/tenants\/[0-9a-f-]+\?saved=paused$/);
  await expect(page.getByText("Tenant saved. The reminder is ready, but automatic sending is paused.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Monthly rent" })).toBeVisible();
  await expect(page.getByText("Not received", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Lease start date")).toHaveValue("2026-07-01");
  await expect(page.getByLabel("Lease type")).toHaveValue("month_to_month");

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

  await page.goto("/admin/automation");
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  expect((await page.request.get("/api/admin/automation/summary")).status()).toBe(404);

  await page.goto("/admin");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/admin\/login$/);
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
});
