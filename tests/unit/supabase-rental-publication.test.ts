import { describe, expect, it, vi } from "vitest";
import { SupabaseRepository } from "../../src/data/supabase-repository";
import type { RentalListing } from "../../src/lib/contracts";
import { v1ToV2 } from "../../src/features/rentals/v2";

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
  it("accepts a unit without a street address and normalizes the database display address", async () => {
    const repository = new SupabaseRepository();
    const payload = v1ToV2({ ...draftWithoutMedia, addressLine: "" });
    payload.property.unitNumber = "101";
    const rpc = vi.spyOn(repository as unknown as {
      rpc(name: string, args: unknown): Promise<unknown>;
    }, "rpc").mockResolvedValue({
      id: draftWithoutMedia.id,
      slug: payload.slug,
      title: payload.title,
      description: payload.description,
      address_line: "Unit 101, ",
      city: payload.property.city,
      monthly_rent_cents: draftWithoutMedia.monthlyRentCents,
      bedrooms: draftWithoutMedia.bedrooms,
      bathrooms: draftWithoutMedia.bathrooms,
      square_feet: null,
      sort_order: 0,
      status: "draft",
      property: payload.property,
      images: [],
      created_at: draftWithoutMedia.createdAt,
      updated_at: draftWithoutMedia.updatedAt
    });

    const rental = await repository.createRental(payload, "00000000-0000-4000-8000-000000000001");

    expect(rpc).toHaveBeenCalledWith("save_rental_listing_v2", expect.objectContaining({
      p_payload: expect.objectContaining({
        property: expect.objectContaining({ streetAddress: "", unitNumber: "101" })
      })
    }));
    expect(rental.addressLine).toBe("Unit 101");
    expect(rental.property?.streetAddress).toBe("");
    expect(rental.property?.unitNumber).toBe("101");
  });

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
