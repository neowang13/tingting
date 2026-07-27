export const rentalManagementService = {
  key: "rental_management",
  title: "Rental Management",
  summary: "Tenant support, rent coordination, inspections, and day-to-day care for rental properties.",
  ctaLabel: "Explore Rental Management"
} as const;

const legacyServiceKeys = ["renovation", "handyman", "maintenance", "strata"];
const currentServiceKeys = [...legacyServiceKeys, "rental_management"];

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

  let services = content.services;
  let keys = services.map((service) =>
    service && typeof service === "object" && !Array.isArray(service)
      ? (service as Record<string, unknown>).key
      : undefined
  );

  if (
    keys.length !== legacyServiceKeys.length ||
    !keys.every((key, index) => key === legacyServiceKeys[index])
  ) {
    if (
      keys.length !== currentServiceKeys.length ||
      !keys.every((key, index) => key === currentServiceKeys[index])
    ) {
      return value;
    }
  } else {
    services = [...services, structuredClone(rentalManagementService)];
    keys = currentServiceKeys;
  }

  return {
    ...content,
    services: services.map((service, index) => {
      const card = service as Record<string, unknown>;
      return {
        key: keys[index],
        title: card.title,
        summary: card.summary,
        ctaLabel: card.ctaLabel
      };
    })
  };
}
