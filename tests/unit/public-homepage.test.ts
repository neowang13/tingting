import { beforeEach, describe, expect, it } from "vitest";
import { buildRentalSearchUrl } from "../../src/components/public/rental-search";
import { store } from "../../src/data/store";
import { loadPublicHomepageData } from "../../src/features/content/public-homepage";

describe("public homepage boundary", () => {
  beforeEach(() => store.reset());

  it("keeps draft section content out of public rendering", async () => {
    const hero = store.getSection("hero");
    const draft = {
      ...(hero.draftContent as Record<string, unknown>),
      heading: "DRAFT CONTENT MUST NOT APPEAR"
    };

    store.saveSectionDraft("hero", draft, hero.updatedAt);

    expect((await loadPublicHomepageData()).sections.hero.heading).toBe("Find Your Perfect Rental");
  });

  it("preserves the fixed service identity and order", async () => {
    const services = (await loadPublicHomepageData()).sections.property_services.services;
    expect(services.map((service) => service.key))
      .toEqual(["rental_management", "trade_services", "property_care", "strata"]);
    expect(services.filter((service) => service.key === "property_care")).toHaveLength(1);
    expect(services[2]).toMatchObject({
      title: "Property Care: Handyman + Maintenance",
      summary: "One-time fixes and ongoing upkeep, with clear scope and trade referrals where required."
    });
    expect(services[0]).toMatchObject({
      title: "Rental Management",
      summary: "Residential and commercial rental-management support, with scope and next steps tailored to the property."
    });
  });

  it("returns only published rentals and caps the homepage at three", async () => {
    const rentals = (await loadPublicHomepageData()).rentals;
    expect(rentals.length).toBeLessThanOrEqual(3);
    expect(rentals.length).toBeGreaterThan(0);
    expect(rentals.every((rental) => rental.status === "published")).toBe(true);
  });
});

describe("rental search serialization", () => {
  it("includes non-empty filters and omits empty controls", () => {
    expect(buildRentalSearchUrl([
      ["location", "Burnaby"],
      ["propertyType", "apartment"],
      ["priceRange", ""],
      ["beds", "2"],
      ["baths", ""]
    ])).toBe("/rentals?location=Burnaby&propertyType=apartment&beds=2");
  });
});
