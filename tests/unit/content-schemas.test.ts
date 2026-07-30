import { describe, expect, it } from "vitest";
import { demoSections } from "../../src/data/demo";
import { sectionSchemas } from "../../src/features/content/schemas";
import { getAllServicePages } from "../../src/features/content/service-pages";

describe("fixed section registry", () => {
  it("contains the eight homepage sections and five service pages", () => {
    expect(Object.keys(sectionSchemas)).toEqual([
      "header",
      "hero",
      "rental_search",
      "property_services",
      "featured_rentals",
      "about",
      "contact",
      "footer",
      "service_renovation",
      "service_handyman",
      "service_maintenance",
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
    legacyContent.services = legacyContent.services.filter(
      (service) => service.key !== "rental_management"
    );

    expect(sectionSchemas.property_services.parse(legacyContent).services.map((service) => service.key))
      .toEqual(["rental_management", "renovation", "handyman", "maintenance", "strata"]);
  });

  it("moves rental management to the front of historical five-service content", () => {
    const propertyServices = demoSections.find((section) => section.key === "property_services");
    const historical = structuredClone(propertyServices?.publishedContent) as {
      services: Array<{ key: string }>;
    };
    historical.services.push(historical.services.shift()!);

    expect(sectionSchemas.property_services.parse(historical).services.map((service) => service.key))
      .toEqual(["rental_management", "renovation", "handyman", "maintenance", "strata"]);
  });

  it.each(getAllServicePages().map((page) => [page.sectionKey, page.content] as const))(
    "keeps %s to its fixed core services and excludes FAQ/process content",
    (key, content) => {
      const parsed = sectionSchemas[key].parse(content) as Record<string, unknown>;
      expect(parsed.services).toHaveLength(key === "service_handyman" ? 5 : 4);
      expect(parsed.benefits).toHaveLength(4);
      expect(parsed).not.toHaveProperty("process");
      expect(parsed).not.toHaveProperty("faq");
    }
  );

  it("upgrades historical handyman content with minor plumbing repairs", () => {
    const handyman = structuredClone(
      getAllServicePages().find((page) => page.sectionKey === "service_handyman")?.content
    ) as { services: Array<{ title: string; body: string }> };
    handyman.services.pop();

    const parsed = sectionSchemas.service_handyman.parse(handyman);
    expect(parsed.services).toHaveLength(5);
    expect(parsed.services.at(-1)).toMatchObject({
      title: "Minor Plumbing Repairs",
      body: "Help with faucets, drains, fixtures, caulking, and minor leaks. Specialized plumbing work is handled by qualified trades."
    });
  });

  it("requires three renovation gallery cards and four on the other service pages", () => {
    for (const page of getAllServicePages()) {
      expect(page.content.gallery).toHaveLength(page.sectionKey === "service_renovation" ? 3 : 4);
    }
  });
});
