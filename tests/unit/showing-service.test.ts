import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getDemoShowingRequestsForTests,
  submitShowingRequest
} from "../../src/features/showings/service";
import { renderShowingRequestNotification } from "../../src/features/showings/notification";

const payload = {
  name: "Website Visitor",
  phone: "604-555-0182",
  email: "visitor@example.test",
  propertySlug: "howe-street-one-bedroom",
  desiredMoveInDate: "2026-09-01",
  requestedLocalDate: "2026-08-03",
  requestedLocalTime: "10:30",
  timezone: "America/Vancouver" as const,
  notes: "Please call when you arrive.",
  hasPets: false,
  needsParking: true,
  representationDisclosureAcknowledged: true as const,
  consent: true as const,
  website: ""
};

describe("showing request service", () => {
  const originalBackend = process.env.DATA_BACKEND;
  const request = new Request("https://example.test/api/public/showings", {
    headers: { "x-forwarded-for": "203.0.113.41", "user-agent": "showing-test" }
  });

  beforeEach(() => {
    process.env.DATA_BACKEND = "memory";
    globalThis.__tingtingShowingRateLimits = new Map();
    globalThis.__tingtingShowingRequests = [];
  });

  afterEach(() => {
    process.env.DATA_BACKEND = originalBackend;
    globalThis.__tingtingShowingRateLimits = undefined;
    globalThis.__tingtingShowingRequests = undefined;
    vi.restoreAllMocks();
  });

  it("persists a requested status with server-resolved property context", async () => {
    const result = await submitShowingRequest(payload, request, {
      now: "2026-08-01T16:00:00Z",
      recipient: null
    });
    expect(result).toMatchObject({ accepted: true, status: "requested" });
    expect(getDemoShowingRequestsForTests()).toEqual([
      expect.objectContaining({
        propertyId: "20000000-0000-4000-8000-000000000001",
        propertyTitle: "Bright Downtown One Bedroom",
        propertyAddress: "1104 – 1231 Howe Street, Vancouver",
        status: "requested",
        requestedStartAt: "2026-08-03T17:30:00Z"
      })
    ]);
  });

  it("notifies the configured recipient with contact, property, schedule, and requested status", async () => {
    const send = vi.fn().mockResolvedValue({ providerMessageId: "test-message", status: "queued" });
    await submitShowingRequest(payload, request, {
      now: "2026-08-01T16:00:00Z",
      recipient: "tingting@example.test",
      notifier: { send }
    });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      to: "tingting@example.test",
      subject: "Showing requested: Bright Downtown One Bedroom",
      text: expect.stringContaining("REQUESTED — not yet confirmed")
    }));
    expect(send.mock.calls[0][0].text).toContain("604-555-0182");
    expect(send.mock.calls[0][0].text).toContain("Monday, August 3, 2026 at 10:30 a.m. PDT");
    expect(send.mock.calls[0][0].text).toContain("Contact requester: sms:+16045550182");
    expect(send.mock.calls[0][0].text).toContain("Call requester: tel:+16045550182");
    expect(send.mock.calls[0][0].html).toContain('href="sms:+16045550182"');
    expect(send.mock.calls[0][0].html).toContain("Direct phone number");
    expect(send.mock.calls[0][0].html).toContain('href="tel:+16045550182"');
  });

  it("does not persist honeypot submissions", async () => {
    await expect(submitShowingRequest({ ...payload, website: "spam.example" }, request, {
      now: "2026-08-01T16:00:00Z",
      recipient: null
    })).resolves.toEqual({ accepted: true, status: "requested" });
    expect(getDemoShowingRequestsForTests()).toHaveLength(0);
  });

  it("rejects incomplete, unavailable, and unpublished-property submissions", async () => {
    await expect(submitShowingRequest({ ...payload, phone: "" }, request, { now: "2026-08-01T16:00:00Z" }))
      .rejects.toMatchObject({ name: "ZodError" });
    await expect(submitShowingRequest({ ...payload, requestedLocalDate: "2026-08-02" }, request, { now: "2026-08-01T16:00:00Z" }))
      .rejects.toMatchObject({ code: "SHOWING_DAY_UNAVAILABLE" });
    await expect(submitShowingRequest({ ...payload, propertySlug: "missing-property" }, request, { now: "2026-08-01T16:00:00Z" }))
      .rejects.toMatchObject({ code: "SHOWING_PROPERTY_NOT_FOUND" });
  });

  it("escapes visitor content in the HTML notification", () => {
    const notification = renderShowingRequestNotification({
      requestId: "request-1",
      request: { ...payload, notes: "<script>alert(1)</script>" },
      property: { title: "Home", addressLine: "1 Main", city: "Vancouver", slug: "home" },
      requestedStartAt: "2026-08-03T17:30:00Z"
    });
    expect(notification.html).not.toContain("<script>");
    expect(notification.html).toContain("&lt;script&gt;");
    expect(notification.actions.message).toBe("sms:+16045550182");
    expect(notification.actions.call).toBe("tel:+16045550182");
  });
});
