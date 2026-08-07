import { describe, expect, it } from "vitest";
import {
  buildContactActionUris,
  buildMailtoUri,
  normalizeDialablePhone,
  renderContactNotification
} from "../../src/features/contact/follow-up";

describe("contact follow-up links", () => {
  it("encodes email addresses and normalizes Canadian phone numbers", () => {
    expect(buildMailtoUri("ting+rentals@example.com"))
      .toBe("mailto:ting%2Brentals%40example.com");
    expect(normalizeDialablePhone("(604) 872-6896")).toBe("+16048726896");
    expect(buildContactActionUris({
      email: "ting+rentals@example.com",
      phone: "(604) 872-6896"
    })).toEqual({
      email: "mailto:ting%2Brentals%40example.com",
      call: "tel:+16048726896",
      text: "sms:+16048726896"
    });
  });

  it("rejects unsafe or unusable URI destinations", () => {
    expect(buildMailtoUri("person@example.com\r\nBcc: hidden@example.com")).toBeNull();
    expect(normalizeDialablePhone("call me maybe")).toBeNull();
  });

  it("renders escaped email and text templates with direct actions only for supplied destinations", () => {
    const notification = renderContactNotification({
      name: "Visitor <script>",
      email: "visitor+listing@example.com",
      phone: "604.555.0123",
      preferredContact: "sms",
      message: "Interested in <Unit 4>.\nPlease reply soon.",
      website: ""
    });

    expect(notification.text).toContain("mailto:visitor%2Blisting%40example.com");
    expect(notification.text).toContain("tel:+16045550123");
    expect(notification.text).toContain("sms:+16045550123");
    expect(notification.html).toContain('href="mailto:visitor%2Blisting%40example.com"');
    expect(notification.html).toContain('href="tel:+16045550123"');
    expect(notification.html).toContain('href="sms:+16045550123"');
    expect(notification.html).not.toContain("<script>");
    expect(notification.html).toContain("&lt;Unit 4&gt;");

    const urls = [
      notification.actions.email,
      notification.actions.call,
      notification.actions.text
    ].filter(Boolean).join(" ");
    expect(urls).not.toContain("Visitor");
    expect(urls).not.toContain("Interested");
    expect(urls).not.toContain("reply");
    expect(urls).not.toContain("?");
  });
});
