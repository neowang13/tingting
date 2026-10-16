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
  requestedLocalDate: "2026-08-03",
  timezone: "America/Vancouver" as const,
  notes: "Please call when you arrive.",
  website: ""
};

const schedule = {
  timezone: "America/Vancouver" as const,
  rentalListingId: "20000000-0000-4000-8000-000000000001",
  openWeekdays: [1],
  dateOverrides: [],
  updatedAt: "2026-08-01T15:00:00Z"
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
    globalThis.__tingtingPropertyViewingSchedules = new Map([[schedule.rentalListingId, structuredClone(schedule)], ["20000000-0000-4000-8000-000000000002", { ...schedule, rentalListingId: "20000000-0000-4000-8000-000000000002" }]]);
  });

  afterEach(() => {
    process.env.DATA_BACKEND = originalBackend;
    globalThis.__tingtingShowingRateLimits = undefined;
    globalThis.__tingtingShowingRequests = undefined;
    globalThis.__tingtingPropertyViewingSchedules = undefined;
    vi.restoreAllMocks();
  });

  it("books a configured slot as accepted with server-resolved property context", async () => {
    const result = await submitShowingRequest(payload, request, {
      now: "2026-08-01T16:00:00Z",
      recipient: null
    });
    expect(result).toMatchObject({
      accepted: true,
      status: "accepted",
      message: expect.stringMatching(/registered/i)
    });
    expect(getDemoShowingRequestsForTests()).toEqual([
      expect.objectContaining({
        propertyId: "20000000-0000-4000-8000-000000000001",
        propertyTitle: "Bright Downtown One Bedroom",
        propertyAddress: "1104 – 1231 Howe Street, Vancouver",
        status: "accepted",
        requestedStartAt: null, requestedLocalDate: "2026-08-03", requestedLocalTime: null
      })
    ]);
    expect(getDemoShowingRequestsForTests()[0]).not.toHaveProperty("consentAt");
  });

  it("notifies the configured recipient that the viewing is confirmed", async () => {
    const send = vi.fn().mockResolvedValue({ providerMessageId: "test-message", status: "queued" });
    await submitShowingRequest(payload, request, {
      now: "2026-08-01T16:00:00Z",
      recipient: "tingting@example.test",
      notifier: { send }
    });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      to: "tingting@example.test",
      subject: expect.stringMatching(/registered.*Bright Downtown One Bedroom/i),
      text: expect.stringContaining("DATE REGISTERED")
    }));
    expect(send.mock.calls[0][0].text).not.toContain("Desired move-in");
    expect(send.mock.calls[0][0].text).not.toContain("Pets:");
    expect(send.mock.calls[0][0].text).not.toContain("Parking required:");
    expect(send.mock.calls[0][0].text).toContain("604-555-0182");
    expect(send.mock.calls[0][0].text).toContain("Monday, August 3, 2026");
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
    })).resolves.toEqual({ accepted: true, status: "accepted" });
    expect(getDemoShowingRequestsForTests()).toHaveLength(0);
  });

  it("rejects incomplete, unconfigured, and unpublished-property submissions", async () => {
    await expect(submitShowingRequest({ ...payload, phone: "" }, request, { now: "2026-08-01T16:00:00Z" }))
      .rejects.toMatchObject({ name: "ZodError" });
    await expect(submitShowingRequest({ ...payload, requestedLocalDate: "2026-08-04" }, request, { now: "2026-08-01T16:00:00Z" }))
      .rejects.toMatchObject({ code: "SHOWING_DATE_UNAVAILABLE" });
    await expect(submitShowingRequest({ ...payload, propertySlug: "missing-property" }, request, { now: "2026-08-01T16:00:00Z" }))
      .rejects.toMatchObject({ code: "SHOWING_PROPERTY_NOT_FOUND" });
  });

  it.each([
    "requestedLocalTime",
    "desiredMoveInDate",
    "hasPets",
    "needsParking",
    "consent",
    "representationDisclosureAcknowledged"
  ])(
    "accepts but ignores the obsolete %s field during rollout",
    async (field) => {
      await expect(submitShowingRequest({ ...payload, [field]: true }, request, {
        now: "2026-08-01T16:00:00Z",
        recipient: null
      })).resolves.toMatchObject({ accepted: true, status: "accepted" });
      expect(getDemoShowingRequestsForTests()).toHaveLength(1);
      expect(getDemoShowingRequestsForTests()[0]).not.toHaveProperty("consentAt");
    }
  );

  it("allows multiple groups on the same date, both within a property and across properties", async () => {
    await submitShowingRequest(payload, request, { now: "2026-08-01T16:00:00Z", recipient: null });

    const secondRequest = new Request("https://example.test/api/public/showings", {
      headers: { "x-forwarded-for": "203.0.113.42", "user-agent": "showing-test" }
    });
    await submitShowingRequest({ ...payload, email: "second@example.test", phone: "6045550183" }, secondRequest, { now: "2026-08-01T16:00:00Z", recipient: null });
    await expect(submitShowingRequest({ ...payload, email: "third@example.test", phone: "6045550184", propertySlug: "melville-street-two-bedroom" }, secondRequest, {
      now: "2026-08-01T16:01:00Z",
      recipient: null
    })).resolves.toMatchObject({ status: "accepted" });
    expect(getDemoShowingRequestsForTests()).toHaveLength(3);
  });

  it("escapes visitor content in the HTML notification", () => {
    const notification = renderShowingRequestNotification({
      requestId: "request-1",
      request: { ...payload, notes: "<script>alert(1)</script>" },
      property: { title: "Home", addressLine: "1 Main", city: "Vancouver", slug: "home" }
    });
    expect(notification.html).not.toContain("<script>");
    expect(notification.html).toContain("&lt;script&gt;");
    expect(notification.actions.message).toBe("sms:+16045550182");
    expect(notification.actions.call).toBe("tel:+16045550182");
  });
});
