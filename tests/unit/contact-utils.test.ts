import { describe, expect, it } from "vitest";
import {
  maskEmail,
  maskPhone,
  normalizeEmail,
  normalizePhoneE164
} from "../../src/features/tenants/contact-utils";

describe("tenant contact normalization", () => {
  it("normalizes Canadian phone and email input", () => {
    expect(normalizePhoneE164("(604) 555-0123")).toBe("+16045550123");
    expect(normalizePhoneE164("+44 20 7946 0958")).toBe("+442079460958");
    expect(normalizeEmail(" ADMIN@Example.COM ")).toBe("admin@example.com");
  });

  it("masks destinations for ordinary lists", () => {
    expect(maskEmail("tenant@example.com")).toBe("t***@example.com");
    expect(maskPhone("+16045550123")).toBe("+16***23");
  });
});
