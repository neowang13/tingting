import { describe, expect, it, vi } from "vitest";
import { SupabaseRepository } from "../../src/data/supabase-repository";
import type { RentalListing } from "../../src/lib/contracts";

const draftWithoutMedia: RentalListing = {
  id: "20000000-0000-4000-8000-000000000099",
  slug: "draft-without-media",
  title: "Draft without media",
  addressLine: "100 Test Street",
  neighbourhood: null,
  city: "Vancouver",
  monthlyRentCents: 250000,
  bedrooms: 1,
  bathrooms: 1,
  squareFeet: null,
  availableOn: null,
  petPolicy: null,
  description: "Test rental.",
  status: "draft",
  sortOrder: 0,
  coverImageUrl: null,
  images: [],
  createdAt: "2026-07-27T10:20:04.000Z",
  updatedAt: "2026-07-27T10:20:04.000Z",
  publishedAt: null
};

describe("Supabase rental publication", () => {
  it("rejects a rental without a cover before making the publication RPC", async () => {
    const repository = new SupabaseRepository();
    vi.spyOn(repository, "getRental").mockResolvedValue(draftWithoutMedia);

    await expect(
      repository.setRentalStatus(
        draftWithoutMedia.id,
        "publish",
        draftWithoutMedia.updatedAt,
        "00000000-0000-4000-8000-000000000001"
      )
    ).rejects.toMatchObject({
      status: 400,
      code: "COVER_IMAGE_REQUIRED",
      message: "Choose exactly one cover image before publishing."
    });
  });
});
