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

test("public homepage, rental search, rental detail, validation, responsive layout, and accessibility", async ({ page }) => {
  test.setTimeout(60_000);
  const consoleErrors: string[] = [];
  const failedResponses: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`);
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Property, managed like a modern service." })).toBeVisible();
  await expect(page.getByRole("search")).toHaveCount(0);
  await expect(page.getByLabel("Location", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 3, name: "Rental Management" })).toBeVisible();
  await expect(page.getByText(
    "Leasing, rent collection, inspections and maintenance."
  )).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "Trade Services" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "Property Care" })).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 3, name: "Handyman Services" })).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 3, name: "Property Maintenance" })).toHaveCount(0);
  await expect(page.locator(".home-service-card").first()).toContainText("Rental Management");
  await expect(page.getByAltText("TingTing Xu and a Silverkey team member in a Vancouver office"))
    .toHaveAttribute("src", /silverkey-team-banner-2026\.webp/);
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
  await expect(page).toHaveURL(/\/rentals\/howe-street-one-bedroom$/, { timeout: 15_000 });
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

test("Silverkey Admin properties, applications, users, responsive navigation, and accessibility", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/admin");
  await page.getByLabel("Email").fill("admin@example.test");
  await page.getByLabel("Password").fill("test-admin-password");
  await page.getByRole("button", { name: "Sign In" }).click();

  await expect(page).toHaveURL(/\/admin\/properties$/);
  await expect(page.getByRole("heading", { level: 1, name: "Properties" })).toBeVisible();
  expect((await page.request.get("/api/automation/v1/health")).status()).toBe(404);
  expect((await page.request.get("/api/admin/automation/summary")).status()).toBe(404);
  await expect(page.getByRole("link", { name: "Properties" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Applications", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Users", exact: true })).toBeVisible();
  await expect(page.getByPlaceholder("Search property number or address")).toBeVisible();
  await expect(page.getByText("P-000001", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create property" })).toHaveAttribute("href", "/admin/properties/new");
  await expect(page.getByRole("link", { name: "Edit", exact: true }).first()).toBeVisible();
  await page.getByRole("link", { name: "Create property", exact: true }).click();
  await expect(page.getByLabel("Street address (optional)")).not.toHaveAttribute("required", "");
  await page.getByRole("navigation", { name: "Admin navigation" }).getByRole("link", { name: "Properties", exact: true }).click();
  await expectNoSeriousAccessibilityViolations(page);

  await page.getByRole("link", { name: "Applications", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Client applications" })).toBeVisible();
  await expect(page.getByRole("button", { name: /All open/ })).toHaveCount(0);
  await expect(page.locator(".application-filter-pills button")).toHaveCount(4);
  await expect(page.getByRole("button", { name: /Under review/ })).toHaveClass("active");
  await expect(page.getByRole("button", { name: /Approved/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Rejected/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Contract signed/ })).toBeVisible();
  for (const label of ["Under review", "Approved", "Rejected", "Contract signed", "Open applications"]) {
    await expect(page.getByRole("link", { name: label, exact: true })).toHaveCount(0);
  }

  await page.getByRole("link", { name: "Users", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Users" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "User", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Add tenant", exact: true })).toHaveCount(0);
  await expectNoSeriousAccessibilityViolations(page);

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Navigation", exact: true });
  await expect(drawer.getByRole("navigation", { name: "Admin navigation" })).toBeVisible();
  await expect(drawer.getByRole("link", { name: "Properties", exact: true })).toBeVisible();
  await expect(drawer.getByRole("link", { name: "Applications", exact: true })).toBeVisible();
  await expect(drawer.getByRole("link", { name: "Users", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/admin\/login$/);
});
