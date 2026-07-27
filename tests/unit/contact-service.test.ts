import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getDemoContactEnquiriesForTests,
  submitContactEnquiry
} from "../../src/features/contact/service";

const payload = {
  name: "Website Visitor",
  email: "visitor@example.com",
  preferredContact: "email" as const,
  message: "I would like to ask about a rental.",
  website: ""
};

describe("public contact service", () => {
  const originalBackend = process.env.DATA_BACKEND;
  const request = new Request("https://example.test/api/public/contact", {
    headers: { "x-forwarded-for": "203.0.113.10", "user-agent": "contact-test" }
  });

  beforeEach(() => {
    process.env.DATA_BACKEND = "memory";
    globalThis.__tingtingContactRateLimits = new Map();
    globalThis.__tingtingContactEnquiries = [];
  });

  afterEach(() => {
    process.env.DATA_BACKEND = originalBackend;
    globalThis.__tingtingContactRateLimits = undefined;
    globalThis.__tingtingContactEnquiries = undefined;
  });

  it("persists a validated enquiry without exposing infrastructure", async () => {
    await expect(submitContactEnquiry(payload, request)).resolves.toEqual({ accepted: true });
    expect(getDemoContactEnquiriesForTests()).toHaveLength(1);
  });

  it("accepts honeypot submissions without persisting or delivering", async () => {
    await expect(submitContactEnquiry({ ...payload, website: "spam.example" }, request))
      .resolves.toEqual({ accepted: true });
    expect(getDemoContactEnquiriesForTests()).toHaveLength(0);
  });

  it("enforces the shared 15-minute submission limit", async () => {
    for (let index = 0; index < 5; index += 1) {
      await submitContactEnquiry({ ...payload, message: `Message ${index}` }, request);
    }
    await expect(submitContactEnquiry(payload, request)).rejects.toMatchObject({
      status: 429,
      code: "CONTACT_RATE_LIMITED"
    });
  });
});
