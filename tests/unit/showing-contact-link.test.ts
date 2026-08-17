import { afterEach, describe, expect, it } from "vitest";
import {
  createShowingContactToken,
  createShowingContactUrl,
  readShowingContactToken
} from "../../src/features/showings/contact-link";

describe("secure showing contact links", () => {
  const originalSecret = process.env.SHOWING_CONTACT_LINK_SECRET;

  afterEach(() => {
    process.env.SHOWING_CONTACT_LINK_SECRET = originalSecret;
  });

  it("encrypts requester details and rejects tampered or expired links", () => {
    process.env.SHOWING_CONTACT_LINK_SECRET = "test-secret-with-more-than-32-characters";
    const issuedAt = Date.UTC(2026, 7, 17);
    const token = createShowingContactToken({
      phone: "7783856771",
      requesterName: "Neo",
      propertyTitle: "Kings Crossing II",
      requestedTime: "Tuesday at 11:30 a.m."
    }, issuedAt);

    expect(token).toBeTruthy();
    expect(readShowingContactToken(token!, issuedAt + 1_000)).toMatchObject({
      phone: "+17783856771",
      requesterName: "Neo",
      propertyTitle: "Kings Crossing II"
    });
    expect(readShowingContactToken(`${token}x`, issuedAt + 1_000)).toBeNull();
    expect(readShowingContactToken(token!, issuedAt + 15 * 24 * 60 * 60_000)).toBeNull();
  });

  it("creates a normal HTTPS email link without exposing the phone number", () => {
    process.env.SHOWING_CONTACT_LINK_SECRET = "test-secret-with-more-than-32-characters";
    const url = createShowingContactUrl({
      appBaseUrl: "https://silverkey.example",
      phone: "7783856771",
      requesterName: "Neo",
      propertyTitle: "Kings Crossing II",
      requestedTime: "Tuesday at 11:30 a.m."
    });

    expect(url).toMatch(/^https:\/\/silverkey\.example\/contact-requester\//);
    expect(url).not.toContain("7783856771");
    expect(url).not.toContain("Neo");
  });
});
