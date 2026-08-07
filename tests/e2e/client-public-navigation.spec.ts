import { expect, test } from "@playwright/test";

test("signed-in Client can use the account menu, Portal, and Apply online on desktop and mobile", async ({ page }) => {
  await page.goto("/client/login");
  await page.getByLabel("Email").fill("client@example.test");
  await page.getByLabel("Password").fill("test-admin-password");
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("link", { name: "Log in" })).toHaveCount(0);
  const accountMenu = page.getByRole("button", { name: "Open account menu for Demo Applicant" });
  await expect(accountMenu).toBeVisible();
  await accountMenu.click();
  await page.getByRole("link", { name: "Portal" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "My applications" })).toBeVisible();

  await page.goto("/rentals/howe-street-one-bedroom");
  await expect(page.getByRole("button", { name: "Open account menu for Demo Applicant" })).toBeVisible();
  await page.getByRole("link", { name: "Apply online" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /Apply for/ })).toBeVisible();

  for (const width of [320, 375, 430]) {
    await page.setViewportSize({ width, height: 812 });
    await page.goto("/");
    await page.getByRole("button", { name: "Open navigation" }).click();
    const mobileNavigation = page.getByRole("navigation", { name: "Mobile navigation" });
    await expect(mobileNavigation.getByText("Signed in as")).toBeVisible();
    await expect(mobileNavigation.getByText("Demo Applicant")).toBeVisible();
    await expect(mobileNavigation.getByRole("link", { name: "Portal" })).toBeVisible();
  }
});
