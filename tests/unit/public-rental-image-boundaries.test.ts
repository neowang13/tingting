import { beforeEach, describe, expect, it, vi } from "vitest";
import { demoRentals, demoSections } from "@/data/demo";
import type { RentalListing } from "@/lib/contracts";

const mocks = vi.hoisted(() => ({ getRepository: vi.fn() }));
vi.mock("@/data/repository", () => ({ getRepository: mocks.getRepository }));

import { loadPublicHomepageData } from "@/features/content/public-homepage";
import { loadPublicRentalDetailData } from "@/features/content/public-rental-detail";
import { GET as listPublicRentals } from "@/app/api/public/rentals/route";

const unsafeUrl = "https://example.test/rentals/rental-v2.jpg";

function unsafeRental(overrides: Partial<RentalListing> = {}): RentalListing {
  return {
    ...structuredClone(demoRentals[0]),
    id: crypto.randomUUID(),
    slug: `unsafe-${crypto.randomUUID()}`,
    status: "published",
    publishedAt: "2026-08-07T00:00:00.000Z",
    coverImageUrl: unsafeUrl,
    images: [{
      mediaAssetId: crypto.randomUUID(),
      url: unsafeUrl,
      alt: "Synthetic unsafe image",
      sortOrder: 0,
      isCover: true
    }],
    ...overrides
  };
}

function repositoryWith(rentals: RentalListing[], detail = rentals[0]) {
  return {
    listPublicSections: vi.fn().mockResolvedValue(demoSections.map((section) => ({
      key: section.key,
      schemaVersion: section.schemaVersion,
      publishedContent: section.publishedContent,
      publishedAt: section.publishedAt
    }))),
    listRentals: vi.fn().mockResolvedValue(rentals),
    getPublicRentalBySlug: vi.fn().mockResolvedValue(detail),
    resolvePublicMedia: vi.fn().mockResolvedValue({})
  };
}

describe("public rental image projection boundaries", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sanitizes homepage rental cards", async () => {
    mocks.getRepository.mockReturnValue(repositoryWith([unsafeRental()]));

    const data = await loadPublicHomepageData();

    expect(data.rentals[0].coverImageUrl).toBeNull();
    expect(data.rentals[0].images[0].url).toBeNull();
  });

  it("sanitizes the public rentals list API", async () => {
    mocks.getRepository.mockReturnValue(repositoryWith([unsafeRental()]));

    const response = await listPublicRentals();
    const result = await response.json();

    expect(result.data[0].coverImageUrl).toBeNull();
    expect(result.data[0].images[0].url).toBeNull();
  });

  it("sanitizes detail and similar rental images", async () => {
    const detail = unsafeRental({ slug: `detail-${crypto.randomUUID()}` });
    const similar = unsafeRental();
    mocks.getRepository.mockReturnValue(repositoryWith([detail, similar], detail));

    const data = await loadPublicRentalDetailData(detail.slug);

    expect(data?.rental.coverImageUrl).toBeNull();
    expect(data?.rental.images).toEqual([]);
    expect(data?.similarRentals[0].coverImageUrl).toBeNull();
    expect(data?.videoTour).toBeNull();
  });

  it("attaches the imported tour to its public rental detail data", async () => {
    const detail = unsafeRental({ slug: "sail-5981-gray-avenue" });
    mocks.getRepository.mockReturnValue(repositoryWith([detail], detail));

    const data = await loadPublicRentalDetailData(detail.slug);

    expect(data?.videoTour).toEqual({
      url: "/listings/facebook/1044446938097580/tour.mp4",
      posterUrl: "/listings/facebook/1044446938097580/tour-poster.jpg",
      title: "Video tour of the home"
    });
  });
});
