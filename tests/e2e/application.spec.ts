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
  await expect(page.getByRole("link", { name: "Book a viewing" })).toBeVisible();

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
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login$/);
  await page.getByLabel("Email").fill("admin@example.test");
  await page.getByLabel("Password").fill("test-admin-password");
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);

  const routes = [
    ["/admin/content", "Website Content"],
    ["/admin/rentals", "Rentals"],
    ["/admin/tenants", "Tenants"],
    ["/admin/notifications/send", "Send Rent Reminder"],
    ["/admin/notifications/templates", "Notification Templates"],
    ["/admin/notifications/history", "Delivery History"],
    ["/admin/automation", "Automation"],
    ["/admin/automation/service-accounts", "Automation Service Accounts"],
    ["/admin/automation/imports", "Tenant Import History"],
    ["/admin/automation/audit", "Automation Audit"],
    ["/admin/settings", "Settings"]
  ] as const;
  for (const [path, heading] of routes) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)
    ).toBe(true);
  }

  await page.goto("/admin/content");
  await expect(page.getByRole("columnheader", { name: "Version" })).toBeVisible();
  await expect(page.getByText("rental_search", { exact: true })).toHaveCount(0);
  await page.goto("/admin/content/hero");
  await expect(page.getByRole("heading", { level: 1, name: "Edit Hero" })).toBeVisible();
  await expect(page.getByLabel("Heading", { exact: true })).toHaveValue("Find Your Perfect Rental");
  await expect(page.getByRole("button", { name: "Save Draft" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish" })).toBeVisible();
  await page.getByLabel("Heading", { exact: true }).fill("Published Directly From Admin");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Published successfully. The public website now uses this content.")).toBeVisible();
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Published Directly From Admin" })).toBeVisible();

  await page.goto("/admin/automation/service-accounts");
  await page.getByLabel("Account name").fill("E2E OpenClaw Operations");
  await page.getByLabel("rentals:read").check();
  await page.getByRole("button", { name: "Create and show token" }).click();
  await expect(page.getByRole("heading", { name: "Save this automation token now" })).toBeVisible();
  await expect(page.locator(".token-value")).toContainText("tta_");
  await page.getByLabel("I saved this token in an approved secret store.").check();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.locator(".token-value")).toHaveCount(0);
  await expectNoSeriousAccessibilityViolations(page);

  await page.goto("/admin");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/admin\/login$/);
  await expect(page.getByRole("heading", { level: 1, name: "Admin Sign In" })).toBeVisible();
});
