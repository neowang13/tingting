import { expect, test } from "@playwright/test";

test("About page separates the current team from historical work", async ({ page }) => {
  await page.goto("/about");

  await expect(page.getByRole("heading", { level: 1, name: "Real estate, handled with care." })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Four people. One standard of care." })).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "Ting Ting Xu" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "Neo Wang" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "Team Member 03" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "Team Member 04" })).toBeVisible();
  await expect(page.locator(".about-redesign-team-member")).toHaveCount(4);

  await expect(page.getByRole("heading", { level: 2, name: "A record built through consistent contribution." })).toBeVisible();
  await expect(page.getByText("They are not presented as awards earned by Silverkey’s current four-person team.")).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Every documented sale, kept in view." })).toBeVisible();
  await expect(page.locator(".about-redesign-sales-dots button")).toHaveCount(10);
  await expect(page.locator(".about-redesign-sales-locations span")).toHaveText(["Vancouver"]);
  await page.getByRole("button", { name: "Next sales archive slide" }).click();
  await expect(page.locator(".about-redesign-sales-locations span")).toHaveText(["Vancouver", "Richmond"]);
});
