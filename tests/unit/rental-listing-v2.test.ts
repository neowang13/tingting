import { beforeEach, describe, expect, it } from "vitest";
import { store } from "../../src/data/store";
import {
  publishRequirementPaths,
  rentalListingV2InputSchema
} from "../../src/lib/schemas";

function completeInput() {
  return {
    slug: "seasons-1703-test",
    title: "Seasons 1703 Test",
    property: {
      id: null,
      expectedVersion: null,
      propertyType: "condo" as const,
      buildingName: "Seasons",
      unitNumber: "1703",
      streetAddress: "5028 Kwantlen Street",
      neighbourhood: "Lansdowne Village",
      city: "Richmond",
      provinceCode: "bc",
      postalCode: "v6x4k2",
      countryCode: "CA" as const
    },
    pricing: { monthlyRentCents: 260000, currencyCode: "CAD" as const },
    layout: {
      bedrooms: 2,
      bathrooms: 2,
      denCount: 0,
      squareFeet: 838,
      furnishedStatus: "unfurnished" as const
    },
    availability: {
      status: "available_now" as const,
      availableOn: null,
      leaseType: "fixed_term" as const,
      minimumLeaseMonths: 12
    },
    parking: {
      available: true,
      type: "underground" as const,
      stalls: 1,
      included: true,
      visitorAvailable: true,
      notes: null
    },
    storage: { available: true, lockers: 1, included: true, notes: null },
    pets: {
      status: "considered" as const,
      catsAllowed: true,
      dogsAllowed: true,
      maxCount: 2,
      sizeLimitLbs: null,
      notes: null
    },
    smokingPolicy: "not_allowed" as const,
    applicationRequirements: { creditCheckRequired: true, referencesRequired: true },
    amenityCodes: ["balcony", "dishwasher", "fitness_room"],
    includedUtilityCodes: ["water", "hot_water", "gas"],
    fees: [{
      feeType: "security_deposit" as const,
      label: null,
      amountCents: 130000,
      frequency: "one_time" as const,
      refundable: true,
      required: true,
      notes: null,
      sortOrder: 0
    }],
    contact: { mode: "site_default" as const, name: null, email: null, phone: null },
    utilitiesNotes: null,
    amenityNotes: null,
    description: "Synthetic complete rental listing fixture.",
    images: []
  };
}

describe("Rental Listing V2 aggregate", () => {
  beforeEach(() => store.reset());

  it("normalizes Canadian address fields and reports publish-only image requirements", () => {
    const parsed = rentalListingV2InputSchema.parse(completeInput());
    expect(parsed.property.provinceCode).toBe("BC");
    expect(parsed.property.postalCode).toBe("V6X 4K2");
    expect(publishRequirementPaths(parsed)).toEqual(["images", "images.cover"]);
  });

  it("rejects contradictory hidden conditional values", () => {
    const input = completeInput();
    input.parking = {
      available: false,
      type: "underground",
      stalls: 1,
      included: true,
      visitorAvailable: false,
      notes: null
    };
    const parsed = rentalListingV2InputSchema.safeParse(input);
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues[0]?.path).toEqual(["parking"]);
  });

  it("saves every structured child in one memory aggregate", () => {
    const saved = store.createRental(completeInput());
    expect(saved.property).toMatchObject({
      propertyType: "condo",
      unitNumber: "1703",
      postalCode: "V6X 4K2"
    });
    expect(saved.amenityCodes).toEqual(["balcony", "dishwasher", "fitness_room"]);
    expect(saved.includedUtilityCodes).toEqual(["water", "hot_water", "gas"]);
    expect(saved.fees).toHaveLength(1);
    expect(saved.reviewRequiredFields).toEqual([]);
    expect(saved.draftDigest).toMatch(/^v2-/);
  });

  it("keeps v1 automation input as a review-required private draft", () => {
    const saved = store.createRental({
      slug: "legacy-v1-draft",
      title: "Legacy V1 Draft",
      addressLine: "101 Test Street",
      neighbourhood: null,
      city: "Vancouver",
      monthlyRentCents: 210000,
      bedrooms: 1,
      bathrooms: 1,
      squareFeet: null,
      availableOn: null,
      petPolicy: "Ask",
      description: "Synthetic v1 compatibility fixture.",
      sortOrder: 0,
      coverImageUrl: null,
      images: []
    });
    expect(saved.status).toBe("draft");
    expect(saved.property?.streetAddress).toBe("101 Test Street");
    expect(saved.reviewRequiredFields).toContain("property.propertyType");
  });
});
