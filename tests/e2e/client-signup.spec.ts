import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("client signup collects identity details and explains email verification", async ({ page }) => {
  await page.goto("/client/login");
  await page.getByRole("link", { name: "Create client account" }).click();

  await expect(page).toHaveURL(/\/client\/signup$/);
  await expect(page.getByRole("heading", { level: 1, name: "Create client account" })).toBeVisible();
  await expect(page.getByLabel("Name")).toHaveAttribute("autocomplete", "name");
  await expect(page.getByLabel("Email")).toHaveAttribute("autocomplete", "email");
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("minlength", "11");
  await expect(page.getByText(/verify your email/i)).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to Client Login" })).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(results.violations.map(({ id }) => id)).toEqual([]);
});
