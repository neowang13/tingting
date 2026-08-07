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

test("generic client login returns home and a rental can start or continue an online application", async ({ page }) => {
  await page.goto("/client/login");
  await page.getByLabel("Email").fill("client@example.test");
  await page.getByLabel("Password").fill("test-admin-password");
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto("/rentals/howe-street-one-bedroom");
  await expect(page.getByRole("button", { name: "Book a viewing" })).toBeVisible();
  await page.getByRole("link", { name: "Apply online" }).click();
  await expect(page).toHaveURL(/\/client\/apply\/howe-street-one-bedroom$/);
  await expect(page.getByRole("heading", { level: 1, name: "Apply for Bright Downtown One Bedroom" })).toBeVisible();
  await page.getByRole("button", { name: "Start or continue application" }).click();
  await expect(page).toHaveURL(/\/client\/applications\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { level: 1, name: "Bright Downtown One Bedroom" })).toBeVisible();
});
