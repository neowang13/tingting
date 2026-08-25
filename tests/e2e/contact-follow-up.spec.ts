import { expect, test } from "@playwright/test";

test("contact form validates, shows configured follow-up actions on success, and preserves failure state", async ({ page }) => {
  await page.goto("/#contact");

  await page.getByRole("button", { name: "Send Message" }).click();
  await expect(page.locator("#homepage-contact-name")).toBeFocused();
  await expect(page.getByRole("status")).toHaveCount(0);

  await page.locator("#homepage-contact-name").fill("Website Visitor");
  await page.locator("#homepage-contact-email").fill("visitor@example.com");
  await page.locator("#homepage-contact-message").fill("Please tell me more about the rental.");
  await page.getByRole("button", { name: "Send Message" }).click();

  const status = page.getByRole("status");
  await expect(status).toContainText("Thank you. We will be in touch shortly.");
  await expect(status.getByRole("link", { name: "Email Ting Ting" }))
    .toHaveAttribute("href", "mailto:info@silverkey.ca");
  await expect(status.getByRole("link", { name: "Call Ting Ting" }))
    .toHaveAttribute("href", "tel:+16048726896");
  await expect(status.getByRole("link", { name: "Text Ting Ting" }))
    .toHaveAttribute("href", "sms:+16048726896");

  await page.route("**/api/public/contact", async (route) => {
    await route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  });
  await page.locator("#homepage-contact-name").fill("Website Visitor");
  await page.locator("#homepage-contact-email").fill("visitor@example.com");
  await page.locator("#homepage-contact-message").fill("Please try this request.");
  await page.getByRole("button", { name: "Send Message" }).click();

  const errorStatus = page.locator(".form-status.error");
  await expect(errorStatus).toContainText("Your message could not be sent. Please try again.");
  await expect(errorStatus.getByRole("link")).toHaveCount(0);
});
