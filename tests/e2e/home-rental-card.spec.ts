import { expect, test } from "@playwright/test";

test("a homepage rental card is one tappable detail link on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");

  const card = page.locator(".home-rental-card").first();
  await expect(card).toHaveAttribute("href", "/rentals/howe-street-one-bedroom");
  await expect(card).toHaveAccessibleName("View home: Bright Downtown One Bedroom");
  await expect(card.locator("a")).toHaveCount(0);

  await card.getByRole("heading", { name: "Bright Downtown One Bedroom" }).click();
  await expect(page).toHaveURL(/\/rentals\/howe-street-one-bedroom$/);
  await expect(page.getByRole("heading", { level: 1, name: "Bright Downtown One Bedroom" })).toBeVisible();
});
