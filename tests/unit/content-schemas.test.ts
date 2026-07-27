import { describe, expect, it } from "vitest";
import { demoSections } from "../../src/data/demo";
import { sectionSchemas } from "../../src/features/content/schemas";

describe("fixed section registry", () => {
  it("contains exactly the eight approved fixed sections", () => {
    expect(Object.keys(sectionSchemas)).toEqual([
      "header",
      "hero",
      "rental_search",
      "property_services",
      "featured_rentals",
      "about",
      "contact",
      "footer"
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
});
