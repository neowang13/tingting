import type { z } from "zod";
import type { RentalListing } from "@/lib/contracts";
import { rentalInputSchema, rentalListingV2InputSchema } from "@/lib/schemas";

export type RentalListingV2Input = z.infer<typeof rentalListingV2InputSchema>;
export type RentalListingV1Input = z.infer<typeof rentalInputSchema>;

export const amenityGroups = [
  {
    label: "Inside the home",
    items: [
      ["balcony", "Balcony"], ["ensuite_bathroom", "Ensuite bathroom"],
      ["air_conditioning", "Air conditioning"], ["laminate_flooring", "Laminate flooring"],
      ["walk_in_closet", "Walk-in closet"], ["floor_to_ceiling_windows", "Floor-to-ceiling windows"],
      ["wheelchair_access", "Wheelchair access"], ["private_yard", "Private yard"],
      ["mountain_view", "Mountain view"], ["city_view", "City view"],
      ["park_view", "Park view"], ["water_view", "Water view"]
    ]
  },
  {
    label: "Appliances",
    items: [
      ["refrigerator", "Refrigerator"], ["stove_oven", "Stove / oven"],
      ["gas_stove", "Gas stove"], ["dishwasher", "Dishwasher"], ["microwave", "Microwave"],
      ["in_suite_washer", "In-suite washer"], ["in_suite_dryer", "In-suite dryer"]
    ]
  },
  {
    label: "Building amenities",
    items: [
      ["elevator", "Elevator"], ["fitness_room", "Fitness room"], ["recreation_room", "Recreation room"],
      ["social_lounge", "Social lounge"], ["swimming_pool", "Swimming pool"], ["hot_tub", "Hot tub"],
      ["sauna", "Sauna"], ["concierge", "Concierge"], ["video_surveillance", "Video surveillance"],
      ["on_site_staff", "On-site staff"], ["shared_laundry", "Shared laundry"],
      ["bicycle_storage", "Bicycle storage"]
    ]
  },
  {
    label: "Nearby conveniences",
    items: [
      ["public_transit", "Public transit"], ["shopping", "Shopping"], ["grocery", "Grocery"],
      ["parks", "Parks"], ["schools", "Schools"], ["restaurants", "Restaurants"]
    ]
  }
] as const;

export const utilityOptions = [
  ["water", "Water"], ["hot_water", "Hot water"], ["gas", "Gas"],
  ["electricity", "Electricity"], ["heating", "Heating"], ["internet", "Internet"],
  ["sewage", "Sewage"], ["garbage_collection", "Garbage collection"]
] as const;

export function isRentalV2Payload(value: unknown): value is RentalListingV2Input {
  return Boolean(value && typeof value === "object" && "property" in value && "pricing" in value);
}

export function parseRentalPayload(value: unknown): {
  v2: RentalListingV2Input;
  legacy: RentalListingV1Input;
} {
  if (isRentalV2Payload(value)) {
    const v2 = rentalListingV2InputSchema.parse(value);
    return { v2, legacy: v2ToLegacy(v2) };
  }
  const legacy = rentalInputSchema.parse(value);
  return { legacy, v2: v1ToV2(legacy) };
}

export function v2ToLegacy(input: RentalListingV2Input): RentalListingV1Input {
  const displayAddress = [
    input.property.unitNumber ? `Unit ${input.property.unitNumber}` : null,
    input.property.streetAddress
  ].filter(Boolean).join(", ");
  return {
    slug: input.slug,
    title: input.title,
    addressLine: displayAddress,
    neighbourhood: input.property.neighbourhood,
    city: input.property.city,
    monthlyRentCents: input.pricing.monthlyRentCents,
    bedrooms: input.layout.bedrooms,
    bathrooms: input.layout.bathrooms,
    squareFeet: input.layout.squareFeet,
    availableOn: input.availability.availableOn,
    petPolicy: input.pets.notes,
    description: input.description,
    sortOrder: 0,
    coverImageUrl: null,
    images: input.images
  };
}

export function v1ToV2(input: RentalListingV1Input): RentalListingV2Input {
  return {
    slug: input.slug,
    title: input.title,
    property: {
      id: null,
      expectedVersion: null,
      propertyType: "other",
      buildingName: null,
      unitNumber: null,
      streetAddress: input.addressLine,
      neighbourhood: input.neighbourhood,
      city: input.city,
      provinceCode: null,
      postalCode: null,
      countryCode: "CA"
    },
    pricing: { monthlyRentCents: input.monthlyRentCents, currencyCode: "CAD" },
    layout: {
      bedrooms: input.bedrooms,
      bathrooms: input.bathrooms,
      denCount: 0,
      squareFeet: input.squareFeet,
      furnishedStatus: null
    },
    availability: {
      status: input.availableOn ? "available_on" : null,
      availableOn: input.availableOn,
      leaseType: null,
      minimumLeaseMonths: null
    },
    parking: {
      available: false, type: null, stalls: null, included: null,
      visitorAvailable: false, notes: null
    },
    storage: { available: false, lockers: null, included: null, notes: null },
    pets: {
      status: null, catsAllowed: false, dogsAllowed: false,
      maxCount: null, sizeLimitLbs: null, notes: input.petPolicy
    },
    smokingPolicy: null,
    applicationRequirements: { creditCheckRequired: false, referencesRequired: false },
    amenityCodes: [],
    includedUtilityCodes: [],
    fees: [],
    contact: { mode: "site_default", name: null, email: null, phone: null },
    utilitiesNotes: null,
    amenityNotes: null,
    description: input.description,
    images: input.images
  };
}

export function rentalToV2(rental: RentalListing): RentalListingV2Input {
  return {
    ...v1ToV2({
      slug: rental.slug,
      title: rental.title,
      addressLine: rental.addressLine,
      neighbourhood: rental.neighbourhood,
      city: rental.city,
      monthlyRentCents: rental.monthlyRentCents,
      bedrooms: rental.bedrooms,
      bathrooms: rental.bathrooms,
      squareFeet: rental.squareFeet,
      availableOn: rental.availableOn,
      petPolicy: rental.petPolicy,
      description: rental.description,
      sortOrder: rental.sortOrder,
      coverImageUrl: rental.coverImageUrl,
      images: rental.images.map(({ mediaAssetId, sortOrder, isCover }) => ({
        mediaAssetId, sortOrder, isCover
      }))
    }),
    property: rental.property ? {
      ...rental.property,
      propertyType: rental.property.propertyType ?? "other",
      expectedVersion: rental.property.updatedAt
    } : {
      id: null,
      expectedVersion: null,
      propertyType: "other",
      buildingName: null,
      unitNumber: null,
      streetAddress: rental.addressLine,
      neighbourhood: rental.neighbourhood,
      city: rental.city,
      provinceCode: null,
      postalCode: null,
      countryCode: "CA"
    },
    pricing: {
      monthlyRentCents: rental.monthlyRentCents,
      currencyCode: rental.currencyCode ?? "CAD"
    },
    layout: {
      bedrooms: rental.bedrooms,
      bathrooms: rental.bathrooms,
      denCount: rental.denCount ?? 0,
      squareFeet: rental.squareFeet,
      furnishedStatus: rental.furnishedStatus ?? null
    },
    availability: {
      status: rental.availabilityStatus ?? (rental.availableOn ? "available_on" : null),
      availableOn: rental.availableOn,
      leaseType: rental.leaseType ?? null,
      minimumLeaseMonths: rental.minimumLeaseMonths ?? null
    },
    parking: rental.parking ? {
      ...rental.parking,
      available: Boolean(rental.parking.available),
      visitorAvailable: Boolean(rental.parking.visitorAvailable)
    } : {
      available: false, type: null, stalls: null, included: null,
      visitorAvailable: false, notes: null
    },
    storage: rental.storage ? {
      ...rental.storage,
      available: Boolean(rental.storage.available)
    } : { available: false, lockers: null, included: null, notes: null },
    pets: rental.pets ?? {
      status: null, catsAllowed: false, dogsAllowed: false,
      maxCount: null, sizeLimitLbs: null, notes: rental.petPolicy
    },
    smokingPolicy: rental.smokingPolicy ?? null,
    applicationRequirements: {
      creditCheckRequired: rental.creditCheckRequired ?? false,
      referencesRequired: rental.referencesRequired ?? false
    },
    amenityCodes: rental.amenityCodes ?? [],
    includedUtilityCodes: rental.includedUtilityCodes ?? [],
    fees: rental.fees ?? [],
    contact: rental.contact ?? { mode: "site_default", name: null, email: null, phone: null },
    utilitiesNotes: rental.utilitiesNotes ?? null,
    amenityNotes: rental.amenityNotes ?? null,
    description: rental.description,
    images: rental.images.map(({ mediaAssetId, sortOrder, isCover }) => ({
      mediaAssetId, sortOrder, isCover
    }))
  };
}

export function rentalV2Fields(input: RentalListingV2Input, now: string) {
  const legacy = v2ToLegacy(input);
  return {
    ...legacy,
    property: {
      id: input.property.id,
      propertyType: input.property.propertyType,
      buildingName: input.property.buildingName,
      unitNumber: input.property.unitNumber,
      streetAddress: input.property.streetAddress,
      neighbourhood: input.property.neighbourhood,
      city: input.property.city,
      provinceCode: input.property.provinceCode,
      postalCode: input.property.postalCode,
      countryCode: input.property.countryCode,
      updatedAt: now
    },
    currencyCode: input.pricing.currencyCode,
    denCount: input.layout.denCount,
    availabilityStatus: input.availability.status,
    furnishedStatus: input.layout.furnishedStatus,
    leaseType: input.availability.leaseType,
    minimumLeaseMonths: input.availability.minimumLeaseMonths,
    parking: input.parking,
    storage: input.storage,
    pets: input.pets,
    smokingPolicy: input.smokingPolicy,
    creditCheckRequired: input.applicationRequirements.creditCheckRequired,
    referencesRequired: input.applicationRequirements.referencesRequired,
    amenityCodes: input.amenityCodes,
    includedUtilityCodes: input.includedUtilityCodes,
    fees: input.fees,
    contact: input.contact,
    utilitiesNotes: input.utilitiesNotes,
    amenityNotes: input.amenityNotes,
    reviewRequiredFields: []
  };
}

export function aggregateDigest(input: unknown): string {
  const value = JSON.stringify(input);
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `v2-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
