import { describe, expect, it } from "vitest";
import { demoSections } from "../../src/data/demo";
import { sectionSchemas } from "../../src/features/content/schemas";
import { getAllServicePages } from "../../src/features/content/service-pages";

describe("fixed section registry", () => {
  it("contains the eight homepage sections and four service pages", () => {
    expect(Object.keys(sectionSchemas)).toEqual([
      "header",
      "hero",
      "rental_search",
      "property_services",
      "featured_rentals",
      "about",
      "contact",
      "footer",
      "service_trade_services",
      "service_property_care",
      "service_strata",
      "service_rental_management"
    ]);
  });

  it.each(demoSections.map((section) => [section.key, section.publishedContent] as const))(
    "validates seeded %s content",
    (key, content) => {
      expect(() => sectionSchemas[key].parse(content)).not.toThrow();
    }
  );

  it("rejects extra structural fields", () => {
    const hero = demoSections.find((section) => section.key === "hero");
    expect(() =>
      sectionSchemas.hero.parse({ ...(hero?.publishedContent as object), arbitraryBlock: {} })
    ).toThrow();
  });

  it("upgrades historical four-service content with rental management", () => {
    const propertyServices = demoSections.find((section) => section.key === "property_services");
    const legacyContent = structuredClone(propertyServices?.publishedContent) as {
      services: Array<{ key: string }>;
    };
    const current = structuredClone(legacyContent.services);
    const trade = current.find((service) => service.key === "trade_services")!;
    const strata = current.find((service) => service.key === "strata")!;
    legacyContent.services = [
      { ...trade, key: "renovation" },
      { ...trade, key: "handyman" },
      { ...trade, key: "maintenance" },
      strata
    ];

    expect(sectionSchemas.property_services.parse(legacyContent).services.map((service) => service.key))
      .toEqual(["rental_management", "trade_services", "property_care", "strata"]);
  });

  it("replaces Renovation and moves rental management to the front of historical five-service content", () => {
    const propertyServices = demoSections.find((section) => section.key === "property_services");
    const historical = structuredClone(propertyServices?.publishedContent) as {
      services: Array<{ key: string }>;
    };
    const current = structuredClone(historical.services);
    const rental = current.find((service) => service.key === "rental_management")!;
    const trade = current.find((service) => service.key === "trade_services")!;
    const strata = current.find((service) => service.key === "strata")!;
    historical.services = [
      { ...trade, key: "maintenance" },
      rental,
      { ...trade, key: "renovation" },
      strata,
      { ...trade, key: "handyman" }
    ];

    const parsed = sectionSchemas.property_services.parse(historical);
    expect(parsed.services.map((service) => service.key))
      .toEqual(["rental_management", "trade_services", "property_care", "strata"]);
    expect(parsed.services[1]).toMatchObject({
      title: "Trade Services",
      ctaLabel: "Explore Trade Services"
    });
  });

  it.each(getAllServicePages().map((page) => [page.sectionKey, page.content] as const))(
    "keeps %s to its fixed core services and excludes FAQ/process content",
    (key, content) => {
      const parsed = sectionSchemas[key].parse(content) as Record<string, unknown>;
      expect(parsed.services).toHaveLength(key === "service_property_care" ? 6 : 4);
      expect(parsed.benefits).toHaveLength(4);
      expect(parsed).not.toHaveProperty("process");
      expect(parsed).not.toHaveProperty("faq");
    }
  );

  it.each(["HANDYMAN SERVICES", "PROPERTY MAINTENANCE"])(
    "upgrades historical %s content to Property Care while preserving selected media",
    (eyebrow) => {
      const legacy = structuredClone(
        getAllServicePages().find((page) => page.sectionKey === "service_property_care")?.content
      ) as { eyebrow: string; heroPosition: string; heroImage: { mediaAssetId: string }; storyImage: { mediaAssetId: string }; services: unknown[]; gallery: Array<{ image?: { mediaAssetId: string } }> };
      legacy.eyebrow = eyebrow;
      legacy.services = legacy.services.slice(0, eyebrow === "HANDYMAN SERVICES" ? 5 : 4);
      legacy.heroPosition = "left 42%";
      legacy.heroImage.mediaAssetId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      legacy.storyImage.mediaAssetId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
      legacy.gallery[0].image!.mediaAssetId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

      const parsed = sectionSchemas.service_property_care.parse(legacy);
      expect(parsed.services).toHaveLength(6);
      expect(parsed.services.map((service) => service.title)).toEqual([
        expect.stringMatching(/^One-Time Fixes/),
        expect.stringMatching(/^One-Time Fixes/),
        expect.stringMatching(/^One-Time Fixes/),
        expect.stringMatching(/^Ongoing Upkeep/),
        expect.stringMatching(/^Ongoing Upkeep/),
        expect.stringMatching(/^Ongoing Upkeep/)
      ]);
      expect(parsed.heroPosition).toBe("left 42%");
      expect(parsed.heroImage.mediaAssetId).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
      expect(parsed.storyImage.mediaAssetId).toBe("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
      expect(parsed.gallery[0].image?.mediaAssetId).toBe("cccccccc-cccc-4ccc-8ccc-cccccccccccc");
    }
  );

  it("requires three trade-services gallery cards and four on the other service pages", () => {
    for (const page of getAllServicePages()) {
      expect(page.content.gallery).toHaveLength(page.sectionKey === "service_trade_services" ? 3 : 4);
    }
  });

  it("migrates Renovation content to compliant Trade Services copy while retaining selected media", () => {
    const legacy = {
      eyebrow: "RENOVATION SERVICES",
      heroPosition: "left 40%",
      heroImage: { mediaAssetId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", alt: "Legacy hero" },
      storyImage: { mediaAssetId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", alt: "Legacy story" },
      services: [
        { image: { mediaAssetId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", alt: "Legacy service" } }
      ],
      gallery: [
        { image: { mediaAssetId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", alt: "Legacy gallery" } }
      ]
    };

    const migrated = sectionSchemas.service_trade_services.parse(legacy);
    expect(migrated.heroPosition).toBe("left 40%");
    expect(migrated.heroImage.mediaAssetId).toBe(legacy.heroImage.mediaAssetId);
    expect(migrated.storyImage.mediaAssetId).toBe(legacy.storyImage.mediaAssetId);
    expect(migrated.services[0].image?.mediaAssetId).toBe(legacy.services[0].image.mediaAssetId);
    expect(migrated.gallery[0].image?.mediaAssetId).toBe(legacy.gallery[0].image.mediaAssetId);
    expect(JSON.stringify(migrated)).not.toMatch(/renovation/i);
  });

  it("upgrades historical rental-management content with two complete scopes and preserves media", () => {
    const legacy = {
      ...structuredClone(
        getAllServicePages().find((page) => page.sectionKey === "service_rental_management")?.content
      ),
      heroPosition: "left 40%",
      heroImage: { mediaAssetId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", alt: "Legacy hero" },
      storyImage: { mediaAssetId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", alt: "Legacy story" },
      managementTypes: undefined
    };

    const migrated = sectionSchemas.service_rental_management.parse(legacy);
    expect(migrated.managementTypes).toHaveLength(2);
    expect(migrated.managementTypes.map((managementType) => managementType.title)).toEqual([
      "Residential Rental Management",
      "Commercial Rental Management"
    ]);
    expect(migrated.managementTypes.every((managementType) =>
      managementType.tasks.length === 3 && managementType.intake && managementType.framework && managementType.escalation
    )).toBe(true);
    expect(migrated.heroPosition).toBe("left 40%");
    expect(migrated.heroImage.mediaAssetId).toBe(legacy.heroImage.mediaAssetId);
    expect(migrated.storyImage.mediaAssetId).toBe(legacy.storyImage.mediaAssetId);
  });
});
