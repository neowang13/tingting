import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

function futureVancouverDate() {
  const candidate = new Date(Date.now() + 3 * 86_400_000);
  const weekday = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: "America/Vancouver"
  });
  while (weekday.format(candidate) === "Sun") candidate.setUTCDate(candidate.getUTCDate() + 1);
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "America/Vancouver"
  }).formatToParts(candidate);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

test("mobile visitors can request a showing with accessible validation and requested-only confirmation", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/rentals/howe-street-one-bedroom");
  await page.getByRole("button", { name: "Book a viewing" }).click();

  const dialog = page.getByRole("dialog", { name: "Choose a time to view this home" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Bright Downtown One Bedroom")).toBeVisible();
  await expect(dialog.getByText(/request—not a confirmed appointment/i)).toBeVisible();
  await expect(dialog.getByLabel("Name *")).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  await dialog.getByRole("button", { name: "Request this showing" }).click();
  expect(await dialog.getByLabel("Name *").evaluate((element) => element.matches(":invalid"))).toBe(true);

  await dialog.getByLabel("Name *").fill("Mobile Visitor");
  await dialog.getByLabel("Phone number *").fill("604-555-0164");
  await dialog.getByLabel("Email address *").fill("mobile@example.test");
  await dialog.getByLabel("Desired move-in date *").fill(futureVancouverDate());
  await dialog.getByLabel("Preferred date *").fill(futureVancouverDate());
  await dialog.getByLabel("Preferred time *").selectOption("11:00");
  await dialog.getByLabel(/I consent to Ting Ting Xu/).check();
  await dialog.getByLabel(/I have reviewed the BCFSA/).check();
  const submitted = page.waitForResponse((response) =>
    response.url().endsWith("/api/public/showings") && response.request().method() === "POST"
  );
  await dialog.getByRole("button", { name: "Request this showing" }).click();
  expect((await submitted).status()).toBe(202);
  await expect(dialog.getByText(/Showing requested—not yet confirmed/)).toBeVisible();
  await expect(dialog.getByText(/contact you to confirm or arrange another time/)).toBeVisible();
  await expect(dialog.getByText(/Need a different time/)).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Continue in Client Login" })).toHaveAttribute("href", /property=howe-street-one-bedroom/);

  const accessibility = await new AxeBuilder({ page })
    .include(".showing-dialog")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);

  await dialog.getByRole("button", { name: "Close showing request form" }).click();
  await expect(page.getByRole("button", { name: "Book a viewing" })).toBeFocused();
});
