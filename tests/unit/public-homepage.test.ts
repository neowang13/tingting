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
    expect((await loadPublicHomepageData()).sections.property_services.services.map((service) => service.key))
      .toEqual(["renovation", "handyman", "maintenance", "strata"]);
  });

  it("returns only published rentals and caps the homepage at three", async () => {
    for (let index = 3; index <= 5; index += 1) {
      const rental = store.createRental({
        slug: `published-rental-${index}`,
        title: `Published Rental ${index}`,
        addressLine: `${index} Test Street`,
        neighbourhood: null,
        city: "Vancouver",
        monthlyRentCents: 250000 + index,
        bedrooms: 1,
        bathrooms: 1,
        squareFeet: null,
        availableOn: null,
        petPolicy: null,
        description: "Published rental fixture.",
        sortOrder: index,
        coverImageUrl: "https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3"
      });
      store.setRentalStatus(rental.id, "publish", rental.updatedAt);
    }

    const rentals = (await loadPublicHomepageData()).rentals;
    expect(rentals).toHaveLength(3);
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
