import { stat } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  formatRentalArea,
  formatRentalAvailability,
  formatRentalCount,
  formatRentalLocation,
  formatRentalPrice,
  getPublicRentalVideo
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

  it("exposes the imported video tour only for the matching rental", () => {
    expect(getPublicRentalVideo("sail-5981-gray-avenue")).toEqual({
      url: "/listings/facebook/1044446938097580/tour.mp4",
      posterUrl: "/listings/facebook/1044446938097580/tour-poster.jpg",
      title: "Video tour of the home"
    });
    expect(getPublicRentalVideo("another-rental")).toBeNull();
  });

  it("keeps the mapped video file in the public build", async () => {
    const video = getPublicRentalVideo("sail-5981-gray-avenue");
    const file = await stat(path.join(process.cwd(), "public", video!.url));

    expect(file.isFile()).toBe(true);
    expect(file.size).toBeGreaterThan(1_000_000);
  });
});
