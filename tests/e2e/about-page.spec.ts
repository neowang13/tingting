import { expect, test } from "@playwright/test";

test("About page follows the supplied team design", async ({ page }) => {
  await page.goto("/about");

  await expect(page.getByRole("heading", { level: 1, name: "Real estate, handled with care." })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "A record built through consistent contribution." })).toBeVisible();
  await expect(page.locator(".about-design-recognition-grid article")).toHaveCount(4);

  await expect(page.getByRole("heading", { level: 2, name: "Who you will actually talk to." })).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "TingTing Xu" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "Neo Wang" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "Hudson Dong" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "Tina Hu" })).toBeVisible();
  await expect(page.locator(".about-design-team-card")).toHaveCount(3);
  await expect(
    page.locator(".about-design-team-card").filter({ hasText: "Hudson Dong" }).getByText("Admin and Assistant", { exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Hudson Dong, Admin and Assistant at Silverkey" })
  ).toBeVisible();
  await expect(page.getByText("Listing presentation, photography and how homes reach the right renters.", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Day-to-day tenancy: inspections, renewals, repairs and notices.", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Rent, owner statements and reconciliation through the brokerage.", { exact: true })).toHaveCount(0);

  await expect(page.getByRole("heading", { level: 2, name: "Want to talk it through first?" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Contact us" })).toHaveAttribute("href", "/#contact");
  await expect(page.getByRole("link", { name: "See services" })).toHaveAttribute("href", "/#services");
  await expect(page.locator(".about-redesign-sales-slider")).toHaveCount(0);
});

test("About page remains usable on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/about");

  await expect(page.getByRole("heading", { level: 1, name: "Real estate, handled with care." })).toBeVisible();
  await expect(page.locator(".about-design-team-card")).toHaveCount(3);
  await expect(page.getByRole("link", { name: "Contact us" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("Public pages share the homepage footer", async ({ page }) => {
  for (const path of ["/", "/about", "/rentals", "/services/property-care", "/privacy", "/terms/application"]) {
    await page.goto(path);
    await expect(page.locator(".home-footer"), `${path} should use the homepage footer`).toBeVisible();
    await expect(page.locator(".home-footer nav")).toHaveAttribute("aria-label", "Footer navigation");
  }
});
