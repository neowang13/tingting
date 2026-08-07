import { beforeEach, describe, expect, it } from "vitest";
import { store } from "../../src/data/store";
import { loadPublicServicePageData } from "../../src/features/content/public-service-page";
import { generateMetadata } from "../../src/app/services/[slug]/page";

describe("public service page boundary", () => {
  beforeEach(() => store.reset());

  it("keeps saved service-page drafts private until publish", async () => {
    const original = store.getSection("service_trade_services");
    const draftTitle = "PRIVATE TRADE SERVICES DRAFT";
    const saved = store.saveSectionDraft(
      "service_trade_services",
      {
        ...(original.draftContent as Record<string, unknown>),
        title: draftTitle
      },
      original.updatedAt
    );

    expect((await loadPublicServicePageData("trade-services"))?.page.title)
      .toBe("A Clear First Step for Property Projects.");

    store.publishSection("service_trade_services", saved.updatedAt);

    expect((await loadPublicServicePageData("trade-services"))?.page.title).toBe(draftTitle);
  });

  it("returns no page for an unknown service slug", async () => {
    await expect(loadPublicServicePageData("not-a-service")).resolves.toBeNull();
  });

  it.each([
    "trade-services",
    "property-care",
    "strata-service",
    "rental-management"
  ])("loads the published %s page with its fixed core services", async (slug) => {
    const result = await loadPublicServicePageData(slug);
    expect(result?.page.services).toHaveLength(slug === "property-care" ? 6 : 4);
    expect(result?.page.benefits).toHaveLength(4);
  });

  it("publishes one combined Property Care page with compliant provider boundaries", async () => {
    const result = await loadPublicServicePageData("property-care");
    expect(result?.sectionKey).toBe("service_property_care");
    expect(result?.page.services.slice(0, 3).every((service) => service.title.startsWith("One-Time Fixes"))).toBe(true);
    expect(result?.page.services.slice(3).every((service) => service.title.startsWith("Ongoing Upkeep"))).toBe(true);
    expect(result?.page.storyBody).toContain("service provider remains responsible");
    expect(result?.page.storyBody).toContain("not an emergency-response line");
  });

  it("uses the canonical Property Care route in SEO metadata", async () => {
    const metadata = await generateMetadata({ params: Promise.resolve({ slug: "property-care" }) });
    expect(metadata.title).toBe("Property Care: Handyman + Maintenance | Ting Ting Xu");
    expect(metadata.alternates).toEqual({ canonical: "/services/property-care" });
    expect(metadata.openGraph).toMatchObject({ url: "/services/property-care" });
  });

  it("publishes distinct residential and commercial management contracts", async () => {
    const result = await loadPublicServicePageData("rental-management");
    expect(result?.page.managementTypes?.map((managementType) => managementType.title)).toEqual([
      "Residential Rental Management",
      "Commercial Rental Management"
    ]);
    expect(result?.page.managementTypes?.[0]).toMatchObject({
      framework: expect.stringContaining("Residential Tenancy Act"),
      escalation: expect.stringContaining("emergency services")
    });
    expect(result?.page.managementTypes?.[1]).toMatchObject({
      framework: expect.stringContaining("residential-tenancy rules do not govern commercial leases"),
      intake: expect.stringContaining("operating-cost terms")
    });
  });

  it("uses the published rental-management description in SEO metadata", async () => {
    const original = store.getSection("service_rental_management");
    const description = "Published residential and commercial rental-management metadata.";
    const saved = store.saveSectionDraft(
      "service_rental_management",
      { ...(original.draftContent as Record<string, unknown>), description },
      original.updatedAt
    );
    store.publishSection("service_rental_management", saved.updatedAt);

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: "rental-management" })
    });
    expect(metadata.title).toBe("Residential & Commercial Rental Management | Ting Ting Xu");
    expect(metadata.description).toBe(description);
    expect(metadata.openGraph).toMatchObject({ description });
  });
});
