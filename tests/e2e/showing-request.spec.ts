import AxeBuilder from "@axe-core/playwright";
import sharp from "sharp";
import { rentalToV2 } from "../../src/features/rentals/v2";
import { expect, test, type Page, type Locator } from "@playwright/test";
const id = "20000000-0000-4000-8000-000000000001";
const calendarPath = `/api/admin/rentals/${id}/viewing-schedule`;
const availabilityPath = "/api/public/showings?propertySlug=howe-street-one-bedroom";

function dateLabel(date: string) {
  return new Intl.DateTimeFormat("en-CA", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC" })
    .format(new Date(`${date}T12:00:00Z`));
}
async function chooseDate(calendar: Locator, date: string) {
  await expect(calendar).toBeVisible();
  const button = calendar.getByRole("button", { name: dateLabel(date), exact: true });
  if (await button.count() === 0) await calendar.getByRole("button", { name: "Next month", exact: true }).click();
  await button.click();
}

async function signIn(page: Page) {
  // Each test represents a separate visitor; do not exhaust the real login limit across the suite.
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": `192.0.2.${test.info().line % 200 + 1}` });
  const response = await page.request.post("/api/auth/login", {
    headers: { origin: new URL(test.info().project.use.baseURL!).origin },
    data: { email: "admin@example.test", password: "test-admin-password" }
  });
  expect(response.ok()).toBe(true);
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
  const existing = await (await page.request.get(calendarPath)).json();
  const response = await page.request.patch(calendarPath, {
    headers: { origin: new URL(test.info().project.use.baseURL!).origin },
    data: { timezone: "America/Vancouver", openWeekdays: [1, 2, 3, 4, 5, 6, 7], dateOverrides: [], expectedUpdatedAt: existing.data.updatedAt }
  });
  expect(response.ok()).toBe(true);
  const live = await response.json();
  const draftPath = `/api/admin/rentals/${id}/viewing-draft`;
  const draft = await (await page.request.get(draftPath)).json();
  const saved = await page.request.patch(draftPath, {
    headers: { origin: new URL(test.info().project.use.baseURL!).origin },
    data: { timezone: "America/Vancouver", openWeekdays: [1, 2, 3, 4, 5, 6, 7], dateOverrides: [],
      expectedUpdatedAt: draft.data.updatedAt, expectedPublishedUpdatedAt: live.data.updatedAt }
  });
  expect(saved.ok()).toBe(true);
});

test("mobile visitors book a date without a time, and multiple groups can use the same date", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const availability = await (await page.request.get(availabilityPath)).json();
  const date = availability.data.dates[0].date as string;
  await page.goto("/rentals/howe-street-one-bedroom");
  await page.getByRole("button", { name: "Book a viewing" }).click();
  const dialog = page.getByRole("dialog", { name: "Choose a date to view this home" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Bright Downtown One Bedroom")).toBeVisible();
  await expect(dialog.getByLabel("Name *")).toBeFocused();
  await expect(dialog.getByLabel("Viewing time *")).toHaveCount(0);
  await expect(dialog.getByLabel("I have pets")).toHaveCount(0);
  await expect(dialog.getByText(/arrange the specific time/i)).toBeVisible();
  await expect(dialog.getByRole("link", { name: "privacy notice" })).toHaveAttribute("href", "/privacy");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await chooseDate(dialog.getByRole("group", { name: "Choose a viewing date", exact: true }), date);
  await dialog.getByRole("button", { name: "Book this viewing" }).click();
  expect(await dialog.getByLabel("Name *").evaluate((element) => element.matches(":invalid"))).toBe(true);
  for (const [name, phone, email] of [["Mobile Visitor", "604-555-0164", "mobile@example.test"], ["Second Visitor", "604-555-0165", "second-mobile@example.test"]]) {
    await dialog.getByLabel("Name *").fill(name);
    await dialog.getByLabel("Phone number *").fill(phone);
    await dialog.getByLabel("Email address *").fill(email);
    await chooseDate(dialog.getByRole("group", { name: "Choose a viewing date", exact: true }), date);
    const submitted = page.waitForResponse((response) => response.url().endsWith("/api/public/showings") && response.request().method() === "POST");
    await dialog.getByRole("button", { name: "Book this viewing" }).click();
    const response = await submitted;
    expect(response.status()).toBe(202);
    expect(response.request().postDataJSON()).not.toHaveProperty("requestedLocalTime");
    await expect(dialog.getByText(/Viewing date registered/)).toBeVisible();
  }
  await expect(dialog.getByRole("link", { name: "Apply online for this home" })).toHaveAttribute("href", "/client/apply/howe-street-one-bedroom");
  const accessibility = await new AxeBuilder({ page }).include(".showing-dialog").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(accessibility.violations).toEqual([]);
  await dialog.getByRole("button", { name: "Close showing request form" }).click();
  await expect(page.getByRole("button", { name: "Book a viewing" })).toBeFocused();
});

test("an empty property calendar disables booking", async ({ page }) => {
  await page.route("**/api/public/showings?*", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: { window: { start: "2026-10-15", end: "2026-11-15", timezone: "America/Vancouver" }, dates: [] } })
  }));
  await page.goto("/rentals/howe-street-one-bedroom");
  await page.getByRole("button", { name: "Book a viewing" }).click();
  const dialog = page.getByRole("dialog", { name: "Choose a date to view this home" });
  await expect(dialog.getByRole("group", { name: "Choose a viewing date", exact: true }).locator("button[data-date]:enabled")).toHaveCount(0);
  await expect(dialog.getByLabel("Viewing time *")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Book this viewing" })).toBeDisabled();
});

test("closing a date refreshes a stale booking form", async ({ page }) => {
  let reads = 0;
  await page.route("**/api/public/showings*", (route) => {
    if (route.request().method() === "GET") {
      reads++;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: {
        window: { start: "2026-10-15", end: "2026-11-15", timezone: "America/Vancouver" },
        dates: reads === 1 ? [{ date: "2026-10-20", label: "Tuesday, October 20" }] : []
      } }) });
    }
    return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ success: false, error: {
      code: "SHOWING_DATE_UNAVAILABLE", message: "This date is no longer available."
    } }) });
  });
  await page.goto("/rentals/howe-street-one-bedroom");
  await page.getByRole("button", { name: "Book a viewing" }).click();
  const dialog = page.getByRole("dialog", { name: "Choose a date to view this home" });
  await dialog.getByLabel("Name *").fill("Stale Date Visitor");
  await dialog.getByLabel("Phone number *").fill("604-555-0166");
  await dialog.getByLabel("Email address *").fill("stale-date@example.test");
  await chooseDate(dialog.getByRole("group", { name: "Choose a viewing date", exact: true }), "2026-10-20");
  await dialog.getByRole("button", { name: "Book this viewing" }).click();
  await expect(dialog.getByRole("alert")).toContainText("no longer available");
  await expect(dialog.locator("input[name=requestedLocalDate]")).toHaveValue("");
  await expect(dialog.getByRole("button", { name: "Book this viewing" })).toBeDisabled();
  expect(reads).toBe(2);
});

test("admin selects calendar dates and publishes the property and exactly the dates visitors can book", async ({ page, browser }) => {
  test.setTimeout(60_000);
  await page.goto(`/admin/properties/${id}`);
  await expect(page.getByRole("heading", { name: "Viewing dates", exact: true })).toBeVisible();
  const calendar = page.getByRole("group", { name: "Select viewing dates", exact: true });
  await expect(calendar).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Admin navigation" }).getByRole("link", { name: "Viewing dates", exact: true })).toHaveCount(0);
  await page.getByRole("navigation", { name: "Property sections" }).getByRole("link", { name: "Viewing dates", exact: true }).click();
  await expect(page.locator("input[type='time']")).toHaveCount(0);
  const otherPath = "/api/admin/rentals/20000000-0000-4000-8000-000000000002/viewing-schedule";
  const before = await (await page.request.get(otherPath)).json();
  const original = await (await page.request.get(availabilityPath)).json();
  const dates = original.data.dates.slice(0, 2).map((entry: { date: string }) => entry.date) as string[];
  await page.getByRole("button", { name: "Clear selection", exact: true }).click();
  await chooseDate(calendar, dates[0]);
  await chooseDate(calendar, dates[1]);
  await expect(page.getByText("2 dates selected", { exact: true })).toBeVisible();
  if (dates[0].slice(0, 7) === dates[1].slice(0, 7)) {
    await calendar.getByRole("button", { name: dateLabel(dates[0]), exact: true }).press("ArrowRight");
    const next = calendar.getByRole("button", { name: dateLabel(dates[1]), exact: true });
    await expect(next).toBeFocused();
    await next.press("Enter");
    await expect(next).toHaveAttribute("aria-pressed", "false");
    await next.press("Enter");
    await expect(next).toHaveAttribute("aria-pressed", "true");
  }
  await expect(page.getByRole("button", { name: "Confirm viewing dates", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Publish", exact: true })).toHaveCount(1);
  await page.getByLabel("Postal code", { exact: true }).fill("V6Z 2E4");
  await page.getByRole("combobox", { name: "Furnishing", exact: true }).selectOption("unfurnished");
  await page.getByRole("combobox", { name: "Lease type", exact: true }).selectOption("month_to_month");
  await page.getByRole("radio", { name: "Considered", exact: true }).check();
  await page.getByRole("radio", { name: "No smoking", exact: true }).check();
  const photo = async (name: string, color: string) => ({ name, mimeType: "image/png",
    buffer: await sharp({ create: { width: 800, height: 600, channels: 3, background: color } }).png().toBuffer() });
  let releaseUploads!: () => void;
  const uploadGate = new Promise<void>(resolve => { releaseUploads = resolve; });
  await page.route("**/api/admin/media", async route => {
    if (route.request().method() === "POST") await uploadGate;
    await route.continue();
  });
  await page.getByLabel("Image files", { exact: true }).setInputFiles([
    await photo("calendar-test-living.png", "#dce8de"), await photo("calendar-test-cover.png", "#dbc39f")
  ]);
  await expect(page.getByRole("button", { name: "Publish", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: /^Upload \d+ images?$/ })).toHaveCount(0);
  releaseUploads();
  await expect(page.getByText("2 images uploaded as private drafts.", { exact: true })).toBeVisible();
  await page.unroute("**/api/admin/media");
  await expect(page.getByRole("radio", { name: "Cover image", exact: true })).toHaveCount(2);
  const droppedPhotos = [await photo("calendar-test-bedroom.png", "#c3d8e9"), await photo("calendar-test-kitchen.png", "#d8cea8")];
  const dataTransfer = await page.evaluateHandle(files => {
    const transfer = new DataTransfer();
    for (const file of files) transfer.items.add(new File([new Uint8Array(file.bytes)], file.name, { type: "image/png" }));
    return transfer;
  }, droppedPhotos.map(file => ({ name: file.name, bytes: Array.from(file.buffer) })));
  await page.getByRole("group", { name: "Upload photos", exact: true }).dispatchEvent("drop", { dataTransfer });
  await dataTransfer.dispose();
  await expect(page.getByRole("radio", { name: "Cover image", exact: true })).toHaveCount(4);
  await page.getByRole("radio", { name: "Cover image", exact: true }).nth(1).check();
  const uploadedAssets = (await (await page.request.get("/api/admin/media")).json()).data
    .filter((asset: { originalFilename: string }) => asset.originalFilename.startsWith("calendar-test-"));
  expect(uploadedAssets).toHaveLength(4);
  for (const asset of uploadedAssets) expect((await page.request.get(`/api/public/media/${asset.id}`)).status()).toBe(404);
  await page.locator(".rental-images").screenshot({ path: "/private/tmp/tingting-auto-photo-upload.png" });
  // Calendar clicks remain private until the property is published.
  const unconfirmed = await (await page.request.get(availabilityPath)).json();
  expect(unconfirmed.data.dates).toEqual(original.data.dates);
  await expect(page.getByRole("button", { name: "Save draft", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Unpublish", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByText("Published successfully", { exact: true })).toBeVisible();
  const published = await (await page.request.get(availabilityPath)).json();
  expect(published.data.dates.map((entry: { date: string }) => entry.date)).toEqual(dates);
  const saved = await (await page.request.get(calendarPath)).json();
  expect(saved.data.openWeekdays).toEqual([]);
  const other = await (await page.request.get(otherPath)).json();
  expect(other.data).toEqual(before.data);
  await page.reload();
  await expect(calendar.locator("button[data-date][aria-pressed=true]")).toHaveCount(dates[0].slice(0, 7) === dates[1].slice(0, 7) ? 2 : 1);
  const accessibility = await new AxeBuilder({ page }).include(".viewing-schedule-page").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(accessibility.violations).toEqual([]);

  const visitorContext = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const visitor = await visitorContext.newPage();
  await visitor.goto("/rentals/howe-street-one-bedroom");
  const cover = (await (await page.request.get(`/api/admin/rentals/${id}`)).json()).data.images.find((image: {isCover:boolean}) => image.isCover);
  const heroPhoto = visitor.locator(".rental-gallery-main img");
  await expect(heroPhoto).toHaveAttribute("src", new RegExp(cover.mediaAssetId));
  await expect.poll(() => heroPhoto.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  const publishedImage = await visitor.request.get(`/api/public/media/${cover.mediaAssetId}`);
  expect(publishedImage.status()).toBe(200);
  expect(publishedImage.headers()["content-type"]).toBe("image/webp");
  await visitor.getByRole("button", { name: "Open photo 1 of 4", exact: true }).click();
  const gallery = visitor.getByRole("dialog", { name: "Bright Downtown One Bedroom photos", exact: true });
  await expect.poll(() => gallery.locator(".rental-gallery-dialog-image img").evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await gallery.getByRole("button", { name: "Next photo", exact: true }).click();
  await expect(gallery.getByText("2 of 4", { exact: true })).toBeVisible();
  await expect.poll(() => gallery.locator(".rental-gallery-dialog-image img").evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await gallery.getByRole("button", { name: "Close photo gallery", exact: true }).click();
  await visitor.locator(".rental-gallery").screenshot({ path: "/private/tmp/tingting-public-rental-photos.png" });
  await visitor.getByRole("button", { name: "Book a viewing" }).click();
  const dialog = visitor.getByRole("dialog", { name: "Choose a date to view this home" });
  const publicCalendar = dialog.getByRole("group", { name: "Choose a viewing date", exact: true });
  await expect(publicCalendar.getByRole("button", { name: dateLabel(dates[0]), exact: true })).toBeEnabled();
  await chooseDate(publicCalendar, dates[1]);
  await expect(dialog.locator("input[name=requestedLocalDate]")).toHaveValue(dates[1]);
  await expect(publicCalendar.locator("button[data-date]:enabled")).toHaveCount(dates[0].slice(0, 7) === dates[1].slice(0, 7) ? 2 : 1);
  // A date removed by the administrator disappears on the next booking-form open.
  await chooseDate(calendar, dates[1]);
  const calendarPublished = page.waitForResponse(response => response.url().endsWith(`/rentals/${id}/publish`) && response.request().method() === "POST");
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  expect((await calendarPublished).ok()).toBe(true);
  await expect(page.getByText("Published successfully", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Close showing request form" }).click();
  await visitor.getByRole("button", { name: "Book a viewing" }).click();
  await chooseDate(publicCalendar, dates[0]);
  if (dates[0].slice(0, 7) !== dates[1].slice(0, 7)) await publicCalendar.getByRole("button", { name: "Next month", exact: true }).click();
  await expect(publicCalendar.getByRole("button", { name: dateLabel(dates[1]), exact: true })).toBeDisabled();
  await page.locator(".viewing-schedule-page").screenshot({ path: "/private/tmp/tingting-admin-viewing-calendar.png" });
  const publicAccessibility = await new AxeBuilder({ page: visitor }).include(".showing-dialog").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(publicAccessibility.violations).toEqual([]);
  await publicCalendar.screenshot({ path: "/private/tmp/tingting-public-viewing-calendar.png" });
  await visitorContext.close();
});

test("narrow admin uses a sticky hamburger and a dismissible navigation drawer", async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 850 });
  await page.goto(`/admin/properties/${id}`);
  const menu = page.getByRole("button", { name: "Open navigation", exact: true });
  await expect(menu).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Admin navigation" })).toHaveCount(0);
  await page.getByRole("heading", { name: "Viewing dates", exact: true }).scrollIntoViewIfNeeded();
  const bounds = await menu.boundingBox();
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThan(850);
  await menu.click();
  const drawer = page.getByRole("dialog", { name: "Navigation", exact: true });
  await expect(drawer).toBeVisible();
  for (const name of ["Properties", "Applications", "Users"]) {
    await expect(drawer.getByRole("link", { name, exact: true })).toBeVisible();
  }
  const accessibility = await new AxeBuilder({ page }).include(".admin-navigation-drawer")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(accessibility.violations).toEqual([]);
  await page.screenshot({ path: "/private/tmp/tingting-admin-hamburger.png" });
  await page.keyboard.press("Escape");
  await expect(drawer).not.toBeVisible();
  await expect(menu).toBeFocused();
  await menu.click();
  await drawer.getByRole("link", { name: "Applications", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/applications$/);
  await expect(drawer).not.toBeVisible();
  await menu.click();
  await page.getByRole("button", { name: "Close navigation", exact: true }).click();
  await expect(drawer).not.toBeVisible();
});

test("list publication and editing follow the unpublished and published property rules", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/admin/properties/20000000-0000-4000-8000-000000000002");
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  const missingFields = page.getByRole("alert", { name: "Property action error" });
  await expect(missingFields).toContainText("Complete these fields before publishing");
  for (const field of ["At least one property photo", "One cover photo"]) {
    await expect(missingFields).toContainText(field);
  }
  for (const field of ["Postal code", "Furnishing", "Lease type", "Smoking policy", "Pet policy"]) {
    await expect(missingFields).not.toContainText(field);
  }
  expect(await missingFields.evaluate(element => Boolean(element.closest("form") && element.previousElementSibling?.id === "property-viewing-dates"))).toBe(true);
  await expect(missingFields).toHaveCSS("border-top-color", "rgb(180, 35, 24)");
  await expect(missingFields).toHaveCSS("border-top-width", "2px");
  await expect(missingFields).toBeFocused();
  await expect(page.locator(".admin-publish-toast")).toHaveCount(0);
  await missingFields.screenshot({ path: "/private/tmp/tingting-property-publish-validation.png" });
  await page.goto("/admin/properties/new");
  const actions = page.locator(".sticky-rental-actions");
  await expect(actions.getByRole("button")).toHaveText(["Delete", "Save draft", "Publish"]);
  const source = (await (await page.request.get(`/api/admin/rentals/${id}`)).json()).data;
  const payload = rentalToV2(source);
  const slug = `action-test-${Date.now()}`;
  payload.slug = slug;
  payload.title = "Synthetic property action test";
  payload.property = { id: null, expectedVersion: null, propertyType: "condo", buildingName: null,
    unitNumber: null, streetAddress: "1 Synthetic Test Street", neighbourhood: null,
    city: "Vancouver", provinceCode: "BC", postalCode: null, countryCode: "CA" };
  payload.layout.furnishedStatus = null;
  payload.availability.leaseType = null;
  payload.availability.minimumLeaseMonths = null;
  payload.pets.status = null;
  payload.smokingPolicy = null;
  const origin = new URL(test.info().project.use.baseURL!).origin;
  const uploaded = await page.request.post("/api/admin/media", {
    headers: { origin }, multipart: { altText: "Synthetic action test cover", file: {
      name: "action-test.png", mimeType: "image/png",
      buffer: await sharp({ create: { width: 800, height: 600, channels: 3, background: "#e4eadc" } }).png().toBuffer()
    } }
  });
  expect(uploaded.ok()).toBe(true);
  const media = (await uploaded.json()).data;
  payload.images = [{ mediaAssetId: media.id, sortOrder: 0, isCover: true }];
  const created = await page.request.post("/api/admin/rentals", { headers: { origin }, data: payload });
  expect(created.status(), await created.text()).toBe(201);
  const rental = (await created.json()).data;
  const propertyPath = `/admin/properties/${rental.id}`;
  const publicPath = `/rentals/${slug}`;
  await page.goto(propertyPath);
  await expect(actions.getByRole("button")).toHaveText(["Delete", "Save draft", "Publish"]);
  const savedTitle = payload.title;
  const savedDescription = "Synthetic description saved privately before publication.";
  await page.getByRole("textbox", { name: /^Listing description/ }).fill(savedDescription);
  const availability = (await (await page.request.get(availabilityPath)).json()).data;
  const chosenDate = availability.dates[0].date as string;
  await chooseDate(page.getByRole("group", { name: "Select viewing dates", exact: true }), chosenDate);
  await actions.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Property details and viewing dates saved privately. The public website has not changed.", { exact: true })).toBeVisible();
  expect((await page.request.get(publicPath)).status()).toBe(404);
  await page.reload();
  await expect(page.getByLabel("Property title", { exact: true })).toHaveValue(savedTitle);
  await expect(page.getByRole("textbox", { name: /^Listing description/ })).toHaveValue(savedDescription);
  await expect(page.getByText("1 date selected", { exact: true })).toBeVisible();

  await page.goto("/admin/properties");
  const row = page.locator(".property-row").filter({ has: page.locator(`a[href="${propertyPath}"]`) });
  await expect(row.getByRole("button")).toHaveText(["Publish"]);
  await expect(row.getByRole("link", { name: "Edit", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "View property", exact: true })).toHaveCount(0);
  await row.screenshot({ path: "/private/tmp/tingting-property-list-unpublished.png" });
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await row.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(row.getByRole("button", { name: "Unpublish", exact: true })).toBeVisible();
  const confirmation = page.locator(".admin-publish-toast");
  await expect(confirmation).toContainText("Published successfully");
  await expect(confirmation).toHaveCSS("border-top-color", "rgb(38, 119, 70)");
  const toastBounds = (await confirmation.boundingBox())!;
  expect(toastBounds.y).toBe(20);
  expect(Math.abs(toastBounds.x + toastBounds.width - page.viewportSize()!.width + 20)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: "/private/tmp/tingting-publish-confirmation.png" });
  await page.clock.runFor(2999);
  await expect(confirmation).toBeVisible();
  await page.clock.runFor(1);
  await expect(confirmation).toHaveCount(0);
  await page.clock.resume();
  expect((await page.request.get(publicPath)).status()).toBe(200);
  const publishedDates = (await (await page.request.get(`/api/public/showings?propertySlug=${slug}`)).json()).data.dates;
  expect(publishedDates.map((date: {date: string}) => date.date)).toEqual([chosenDate]);
  await row.getByRole("link", { name: "Edit", exact: true }).click();
  await expect(actions.getByRole("button")).toHaveText(["Delete", "Publish"]);
  await expect(page.getByRole("button", { name: "Unpublish", exact: true })).toHaveCount(0);
  await page.getByLabel("Property title", { exact: true }).fill("Saved published change");
  const publicationCalls: string[] = [];
  page.on("request", request => { if (request.method() === "POST" && request.url().includes(`/rentals/${rental.id}/`)) publicationCalls.push(request.url()); });
  // Editing a live property does not change the live snapshot until Publish.
  expect(await (await page.request.get(publicPath)).text()).toContain(savedTitle);
  let requireReauthentication = true;
  await page.route(`**/api/admin/rentals/${rental.id}/viewing-draft`, route => {
    if (route.request().method() === "PATCH" && requireReauthentication) {
      requireReauthentication = false;
      return route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({
        success: false, error: { code: "RECENT_AUTHENTICATION_REQUIRED", message: "Please sign in again before completing this sensitive action." }
      }) });
    }
    return route.continue();
  });
  await actions.getByRole("button", { name: "Publish", exact: true }).click();
  const reauth = page.getByRole("dialog", { name: "Sign in again to continue", exact: true });
  await expect(reauth).toBeVisible();
  await expect(confirmation).toHaveCount(0);
  await expect(reauth.getByLabel("Email", { exact: true })).toHaveValue("admin@example.test");
  await expect(reauth.getByLabel("Email", { exact: true })).toHaveAttribute("readonly", "");
  const reauthAccessibility = await new AxeBuilder({ page }).include(".contact-dialog")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(reauthAccessibility.violations).toEqual([]);
  await reauth.screenshot({ path: "/private/tmp/tingting-property-reauthentication.png" });
  await reauth.getByLabel("Password", { exact: true }).fill("test-admin-password");
  await reauth.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(reauth).not.toBeVisible();
  await expect(page).toHaveURL(new RegExp(propertyPath + "$"));
  await expect(page.getByLabel("Property title", { exact: true })).toHaveValue("Saved published change");
  await expect(page.getByText("1 date selected", { exact: true })).toBeVisible();
  await actions.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByText("Published successfully", { exact: true })).toBeVisible();
  await expect(actions.getByRole("button")).toHaveText(["Delete", "Publish"]);
  expect(await (await page.request.get(publicPath)).text()).toContain("Saved published change");
  expect(publicationCalls.some(url => url.endsWith("/unpublish"))).toBe(false);
  await actions.screenshot({ path: "/private/tmp/tingting-property-actions-published.png" });

  await page.goto("/admin/properties");
  await expect(row.getByRole("button")).toHaveText(["Unpublish"]);
  await row.screenshot({ path: "/private/tmp/tingting-property-list-published.png" });
  const accessibility = await new AxeBuilder({ page }).include(".property-list-actions")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(accessibility.violations).toEqual([]);
  await row.getByRole("button", { name: "Unpublish", exact: true }).click();
  await expect(row.getByRole("button", { name: "Publish", exact: true })).toBeVisible();
  expect((await page.request.get(publicPath)).status()).toBe(404);
  await row.getByRole("link", { name: "Edit", exact: true }).click();
  await expect(page.locator(".listing-state")).toHaveText("Unpublished");
  await expect(page.getByLabel("Property title", { exact: true })).toHaveValue("Saved published change");
  await expect(actions.getByRole("button")).toHaveText(["Delete", "Save draft", "Publish"]);
  await actions.screenshot({ path: "/private/tmp/tingting-property-actions-unpublished.png" });
  await actions.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(actions.getByRole("button")).toHaveText(["Delete", "Publish"]);
  expect((await page.request.get(publicPath)).status()).toBe(200);

  page.once("dialog", (dialog) => dialog.dismiss());
  await actions.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(propertyPath + "$"));
  expect((await page.request.get(`/api/admin/rentals/${rental.id}`)).status()).toBe(200);
  page.once("dialog", (dialog) => dialog.accept());
  await actions.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/properties$/);
  expect((await page.request.get(publicPath)).status()).toBe(404);
  expect((await page.request.get(`/api/admin/rentals/${rental.id}`)).status()).toBe(404);
  expect((await (await page.request.get("/api/admin/rentals")).json()).data.map((row: {id:string}) => row.id)).not.toContain(rental.id);
  expect((await page.request.get(`/api/admin/rentals/${id}`)).status()).toBe(200);
});
