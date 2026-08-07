export const rentalManagementService = {
  key: "rental_management",
  title: "Rental Management",
  summary: "Tenant placement, rent collection, inspections, and day-to-day coordination.",
  ctaLabel: "Rental management"
} as const;

export const tradeServicesService = {
  key: "trade_services",
  title: "Trade Services",
  summary: "Project assessment and coordination with qualified trades.",
  ctaLabel: "Trade services"
} as const;

export const propertyCareService = {
  key: "property_care",
  title: "Property Management",
  summary: "Repairs and ongoing upkeep, clearly scoped from the start.",
  ctaLabel: "Property management"
} as const;

const legacyServiceKeys = ["renovation", "handyman", "maintenance", "strata"];
const legacyTradeServiceKeys = ["trade_services", "handyman", "maintenance", "strata"];
const renovationServiceKeys = [
  "rental_management",
  "renovation",
  "handyman",
  "maintenance",
  "strata"
];
export const propertyServiceKeys = [
  "rental_management",
  "trade_services",
  "property_care",
  "strata"
] as const;

/**
 * Schema v1 contained four fixed services, schema v2 added rental management,
 * and schema v3 removed unused modal copy. Schema v4 replaces Renovation with
 * compliance-scoped Trade Services. Schema v6 merges Handyman and Property
 * Maintenance into Property Care. Schema v7 refreshes the public card copy.
 * Keep historical drafts and revisions
 * readable while normalizing them to the current homepage-card shape.
 */
export function upgradePropertyServicesContent(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;

  const content = value as Record<string, unknown>;
  if (!Array.isArray(content.services)) return value;

  const services = content.services;
  const keys = services.map((service) =>
    service && typeof service === "object" && !Array.isArray(service)
      ? (service as Record<string, unknown>).key
      : undefined
  );

  const validLegacy = keys.length === legacyServiceKeys.length &&
    keys.every((key, index) => key === legacyServiceKeys[index]);
  const validTradeLegacy = keys.length === legacyTradeServiceKeys.length &&
    keys.every((key, index) => key === legacyTradeServiceKeys[index]);
  const validRenovationVersion = keys.length === renovationServiceKeys.length &&
    renovationServiceKeys.every((key) => keys.includes(key));
  const validPreMerge = keys.length === 5 &&
    ["rental_management", "trade_services", "handyman", "maintenance", "strata"]
      .every((key) => keys.includes(key));
  const validCurrent = keys.length === propertyServiceKeys.length &&
    propertyServiceKeys.every((key) => keys.includes(key));
  if (!validLegacy && !validTradeLegacy && !validRenovationVersion && !validPreMerge && !validCurrent) return value;

  const servicesByKey = new Map(
    services.map((service) => {
      const card = service as Record<string, unknown>;
      return [String(card.key), card] as const;
    })
  );
  if (validLegacy || validTradeLegacy) {
    servicesByKey.set("rental_management", structuredClone(rentalManagementService));
  }
  if (validLegacy || validRenovationVersion) {
    servicesByKey.set("trade_services", structuredClone(tradeServicesService));
  }
  if (!servicesByKey.has("property_care")) {
    servicesByKey.set("property_care", structuredClone(propertyCareService));
  }

  return {
    ...content,
    services: propertyServiceKeys.map((key) => {
      const card = servicesByKey.get(key)!;
      return {
        key,
        title: card.title,
        summary: card.summary,
        ctaLabel: card.ctaLabel
      };
    })
  };
}
