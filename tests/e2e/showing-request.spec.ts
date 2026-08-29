import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const availabilityWindow = {
  start: "2026-08-26",
  end: "2026-09-26",
  timezone: "America/Vancouver"
};

test("mobile visitors can book a configured viewing and receive immediate confirmation", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/rentals/howe-street-one-bedroom");
  const availabilityResponse = await page.request.get("/api/public/showings");
  expect(availabilityResponse.ok()).toBe(true);
  const availability = await availabilityResponse.json() as {
    data: { dates: Array<{ date: string; spots: Array<{ time: string }> }> };
  };
  const firstDate = availability.data.dates[0];
  expect(firstDate?.spots.length).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Book a viewing" }).click();

  const dialog = page.getByRole("dialog", { name: "Choose a time to view this home" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Bright Downtown One Bedroom")).toBeVisible();
  await expect(dialog.getByText(/confirmed immediately/i)).toBeVisible();
  await expect(dialog.getByLabel("Name *")).toBeFocused();
  await expect(dialog.getByLabel("Desired move-in date *")).toHaveCount(0);
  await expect(dialog.getByLabel("I have pets")).toHaveCount(0);
  await expect(dialog.getByLabel("I require parking")).toHaveCount(0);
  await expect(dialog.getByLabel(/I consent to Ting Ting Xu/)).toHaveCount(0);
  await expect(dialog.getByLabel(/I have reviewed the BCFSA/)).toHaveCount(0);
  await expect(dialog.getByText(/We use your contact and scheduling details to arrange and administer this viewing/i)).toBeVisible();
  await expect(dialog.getByRole("link", { name: "privacy notice" })).toHaveAttribute("href", "/privacy");
  await expect(dialog.getByText(
    /If your move-in is more than one month away or does not match this home's availability, mention it here\. Include any pet information too\./i
  )).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  await dialog.getByLabel("Viewing date *").selectOption(firstDate.date);
  await dialog.getByLabel("Viewing time *").selectOption(firstDate.spots[0].time);
  await dialog.getByRole("button", { name: "Book this viewing" }).click();
  expect(await dialog.getByLabel("Name *").evaluate((element) => element.matches(":invalid"))).toBe(true);

  await dialog.getByLabel("Name *").fill("Mobile Visitor");
  await dialog.getByLabel("Phone number *").fill("604-555-0164");
  await dialog.getByLabel("Email address *").fill("mobile@example.test");
  const submitted = page.waitForResponse((response) =>
    response.url().endsWith("/api/public/showings") && response.request().method() === "POST"
  );
  await dialog.getByRole("button", { name: "Book this viewing" }).click();
  expect((await submitted).status()).toBe(202);
  await expect(dialog.getByText(/Viewing confirmed/)).toBeVisible();
  await expect(dialog.getByText(/Need a different time/)).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Apply online for this home" }))
    .toHaveAttribute("href", "/client/apply/howe-street-one-bedroom");

  const accessibility = await new AxeBuilder({ page })
    .include(".showing-dialog")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);

  await dialog.getByRole("button", { name: "Close showing request form" }).click();
  await expect(page.getByRole("button", { name: "Book a viewing" })).toBeFocused();
});

test("an empty viewing schedule disables booking", async ({ page }) => {
  await page.route("**/api/public/showings", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: { window: availabilityWindow, dates: [] } })
    });
  });

  await page.goto("/rentals/howe-street-one-bedroom");
  await page.getByRole("button", { name: "Book a viewing" }).click();
  const dialog = page.getByRole("dialog", { name: "Choose a time to view this home" });
  const dateSelect = dialog.getByLabel("Viewing date *");

  await expect(dateSelect.locator("option").first()).toHaveText("Choose a viewing date");
  await expect(dateSelect).toBeDisabled();
  await expect(dialog.getByLabel("Viewing time *")).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Book this viewing" })).toBeDisabled();
});

test("a stale booked spot refreshes availability and clears the selection", async ({ page }) => {
  let availabilityRequests = 0;
  await page.route("**/api/public/showings", async (route) => {
    if (route.request().method() === "GET") {
      availabilityRequests += 1;
      if (availabilityRequests === 3) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ success: false, error: { message: "Viewing times are temporarily unavailable." } })
        });
        return;
      }
      const spots = availabilityRequests === 1
        ? [{ time: "10:30", label: "10:30 a.m." }, { time: "11:00", label: "11:00 a.m." }]
        : [{ time: "11:00", label: "11:00 a.m." }];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: {
            window: availabilityWindow,
            dates: [{ date: "2026-08-31", label: "Monday, August 31", spots }]
          }
        })
      });
      return;
    }
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        success: false,
        error: {
          code: "SHOWING_SLOT_TAKEN",
          message: "That viewing time was just booked. Choose another available time."
        }
      })
    });
  });

  await page.goto("/rentals/howe-street-one-bedroom");
  await page.getByRole("button", { name: "Book a viewing" }).click();
  const dialog = page.getByRole("dialog", { name: "Choose a time to view this home" });
  await dialog.getByLabel("Name *").fill("Stale Slot Visitor");
  await dialog.getByLabel("Phone number *").fill("604-555-0165");
  await dialog.getByLabel("Email address *").fill("stale@example.test");
  await dialog.getByLabel("Viewing date *").selectOption("2026-08-31");
  await dialog.getByLabel("Viewing time *").selectOption("10:30");

  await dialog.getByRole("button", { name: "Book this viewing" }).click();
  await expect(dialog.getByRole("alert")).toContainText("just booked");
  await expect.poll(() => availabilityRequests).toBe(2);
  await expect(dialog.getByLabel("Viewing time *")).toHaveValue("");
  await expect(dialog.getByLabel("Viewing time *").locator("option[value='10:30']")).toHaveCount(0);
  await expect(dialog.getByLabel("Viewing time *").locator("option[value='11:00']")).toHaveCount(1);

  await dialog.getByLabel("Viewing time *").selectOption("11:00");
  await dialog.getByRole("button", { name: "Book this viewing" }).click();
  await expect.poll(() => availabilityRequests).toBe(3);
  await expect(dialog.getByLabel("Viewing time *")).toHaveValue("");
  await expect(dialog.getByRole("button", { name: "Book this viewing" })).toBeDisabled();
  await expect(dialog.getByRole("alert")).toContainText("temporarily unavailable");
});

test("an administrator can publish weekly viewing dates and one-date changes", async ({ page }) => {
  await page.goto("/admin");
  await page.getByLabel("Email").fill("admin@example.test");
  await page.getByLabel("Password").fill("test-admin-password");
  await page.getByRole("button", { name: "Sign In" }).click();

  await page.getByRole("link", { name: "Viewing dates", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Viewing dates" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Weekly viewing times" })).toBeVisible();
  await expect(page.getByText("Monday", { exact: true })).toBeVisible();

  const availability = await (await page.request.get("/api/public/showings")).json() as {
    data: { dates: Array<{ date: string }> };
  };
  const date = availability.data.dates[0]?.date;
  expect(date).toBeTruthy();
  await page.getByLabel("Date", { exact: true }).fill(date);
  await page.getByRole("button", { name: "Apply date change" }).click();
  await page.getByRole("button", { name: "Publish viewing dates" }).click();
  await expect(page.getByText(/Viewing dates published/)).toBeVisible();

  const accessibility = await new AxeBuilder({ page })
    .include(".admin-main")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);
});
