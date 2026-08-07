import { expect, test } from "@playwright/test";

test("Property Management card leads to the canonical Property Care page", async ({ page }) => {
  await page.goto("/");
  const combinedCards = page.getByRole("article").filter({
    has: page.getByRole("heading", { level: 3, name: "Property Management" })
  });
  await expect(combinedCards).toHaveCount(1);
  await expect(combinedCards).toContainText(
    "Repairs and ongoing upkeep, clearly scoped from the start."
  );
  await combinedCards.getByRole("link", { name: "Property management" }).click();
  await expect(page).toHaveURL(/\/services\/property-care$/);
  await expect(page.getByRole("heading", { level: 1, name: "One-Time Fixes and Ongoing Property Upkeep." })).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/services\/property-care$/);
  await expect(page).toHaveTitle("Property Care: Handyman + Maintenance | Ting Ting Xu");
  await expect(page.locator(".service-offering")).toHaveCount(6);
  await expect(page.getByText("This service is not an emergency-response line.")).toBeVisible();

  for (const legacyPath of ["/services/handyman-service", "/services/property-maintenance"]) {
    await page.goto(legacyPath);
    await expect(page).toHaveURL(/\/services\/property-care$/);
  }

  const sitemap = await page.request.get("/sitemap.xml");
  expect(sitemap.ok()).toBe(true);
  const sitemapText = await sitemap.text();
  expect(sitemapText).toContain("/services/property-care");
  expect(sitemapText).not.toContain("/services/handyman-service");
  expect(sitemapText).not.toContain("/services/property-maintenance");

  await page.goto("/admin");
  await page.getByLabel("Email").fill("admin@example.test");
  await page.getByLabel("Password").fill("test-admin-password");
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
  await page.goto("/admin/content");
  const propertyCareRow = page.locator(".content-section-row").filter({ hasText: "Property care: handyman + maintenance" });
  await expect(propertyCareRow).toHaveCount(1);
  await expect(propertyCareRow).toContainText("/services/property-care");
  await expect(page.locator(".content-section-row").filter({ hasText: "/services/handyman-service" })).toHaveCount(0);
  await expect(page.locator(".content-section-row").filter({ hasText: "/services/property-maintenance" })).toHaveCount(0);
});
