import { expect, test } from "@playwright/test";

test("Trade Services is consistent across homepage, detail, redirect, and metadata", async ({ page }) => {
  await page.goto("/");
  const serviceCard = page.getByRole("article").filter({
    has: page.getByRole("heading", { level: 3, name: "Trade Services" })
  });
  await expect(serviceCard).toContainText(
    "Repairs, renovations and trusted trade coordination."
  );
  await serviceCard.getByRole("link", { name: "Learn more" }).click();
  await expect(page).toHaveURL(/\/services\/trade-services$/);
  await expect(page.getByRole("heading", { level: 1, name: "A Clear First Step for Property Projects." }))
    .toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/services\/trade-services$/);
  await expect(page).toHaveTitle("Trade Services | Ting Ting Xu");
  await expect(page.getByText("Scope comes before scheduling.", { exact: true })).toBeVisible();

  await page.goto("/services/renovation");
  await expect(page).toHaveURL(/\/services\/trade-services$/);

});
