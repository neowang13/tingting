export const rentalManagementService = {
  key: "rental_management",
  title: "Rental Management",
  summary: "Tenant support, rent coordination, inspections, and day-to-day care for rental properties.",
  ctaLabel: "Explore Rental Management"
} as const;

const legacyServiceKeys = ["renovation", "handyman", "maintenance", "strata"];
export const propertyServiceKeys = [
  "rental_management",
  "renovation",
  "handyman",
  "maintenance",
  "strata"
] as const;

/**
 * Schema v1 contained four fixed services and schema v2 added rental
 * management. Both versions also carried modal/process copy that the public
 * website no longer uses. Keep old drafts and revisions readable while
 * normalizing them to the schema v3 homepage-card shape.
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
  const validCurrent = keys.length === propertyServiceKeys.length &&
    propertyServiceKeys.every((key) => keys.includes(key));
  if (!validLegacy && !validCurrent) return value;

  const servicesByKey = new Map(
    services.map((service) => {
      const card = service as Record<string, unknown>;
      return [String(card.key), card] as const;
    })
  );
  if (validLegacy) {
    servicesByKey.set("rental_management", structuredClone(rentalManagementService));
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
