import { describe, expect, it } from "vitest";
import {
  formatRentalArea,
  formatRentalAvailability,
  formatRentalCount,
  formatRentalLocation,
  formatRentalPrice
} from "@/features/content/public-rental-detail";

describe("public rental detail formatters", () => {
  it("formats public listing values consistently", () => {
    expect(formatRentalPrice(245_000)).toBe("$2,450");
    expect(formatRentalCount(0)).toBe("0");
    expect(formatRentalCount(1.5)).toBe("1.5");
    expect(formatRentalArea(620)).toBe("620 sq. ft.");
    expect(formatRentalLocation(null, "Vancouver")).toBe("Vancouver");
    expect(formatRentalLocation("Downtown", "Vancouver")).toBe("Downtown, Vancouver");
  });

  it("uses Vancouver calendar semantics for availability", () => {
    expect(formatRentalAvailability(
      "2026-07-27",
      new Date("2026-07-28T06:30:00Z")
    )).toBe("Available now");
    expect(formatRentalAvailability(
      "2026-08-01",
      new Date("2026-07-27T20:00:00Z")
    )).toBe("Aug 1, 2026");
  });
});
