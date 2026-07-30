import { beforeEach, describe, expect, it } from "vitest";
import { store } from "../../src/data/store";
import { loadPublicServicePageData } from "../../src/features/content/public-service-page";

describe("public service page boundary", () => {
  beforeEach(() => store.reset());

  it("keeps saved service-page drafts private until publish", async () => {
    const original = store.getSection("service_renovation");
    const draftTitle = "PRIVATE RENOVATION DRAFT";
    const saved = store.saveSectionDraft(
      "service_renovation",
      {
        ...(original.draftContent as Record<string, unknown>),
        title: draftTitle
      },
      original.updatedAt
    );

    expect((await loadPublicServicePageData("renovation"))?.page.title)
      .toBe("Renovations Designed Around Your Home.");

    store.publishSection("service_renovation", saved.updatedAt);

    expect((await loadPublicServicePageData("renovation"))?.page.title).toBe(draftTitle);
  });

  it("returns no page for an unknown service slug", async () => {
    await expect(loadPublicServicePageData("not-a-service")).resolves.toBeNull();
  });

  it.each([
    "renovation",
    "handyman-service",
    "property-maintenance",
    "strata-service",
    "rental-management"
  ])("loads the published %s page with its fixed core services", async (slug) => {
    const result = await loadPublicServicePageData(slug);
    expect(result?.page.services).toHaveLength(slug === "handyman-service" ? 5 : 4);
    expect(result?.page.benefits).toHaveLength(4);
  });
});
