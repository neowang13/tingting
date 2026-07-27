import { describe, expect, it } from "vitest";
import {
  deliveryModeCopy,
  notificationSourceLabel,
  notificationStatusCopy
} from "../../src/lib/notification-copy";

describe("admin notification copy", () => {
  it("does not describe a queued email as sent", () => {
    expect(notificationStatusCopy("scheduled").label).toBe("Waiting to send");
    expect(notificationStatusCopy("queued").label).toBe("Accepted for delivery");
    expect(notificationStatusCopy("delivered").label).toBe("Delivered");
  });

  it("uses plain language for source and delivery mode", () => {
    expect(notificationSourceLabel("manual")).toBe("One-time reminder");
    expect(deliveryModeCopy("mock").explanation).toContain("no real email");
    expect(deliveryModeCopy("disabled").label).toBe("Email delivery is off");
  });
});
