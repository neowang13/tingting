import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { GET } from "@/app/api/public/media/[id]/route";
import { uploadMediaAsset, promoteDemoMedia, getDemoMediaAsset } from "@/features/content/media-service";
import { store } from "@/data/store";
import { rentalToV2 } from "@/features/rentals/v2";
import { loadPublicRentalDetailData } from "@/features/content/public-rental-detail";
import { resetRepositoryForTests } from "@/data/repository";

async function imageFixture() {
  const bytes = await sharp({ create: { width: 800, height: 600, channels: 3, background: "#dce8de" } }).png().toBuffer();
  return uploadMediaAsset(new File([Uint8Array.from(bytes)], "public-photo.png", { type: "image/png" }), "Rental photo", "admin");
}
function requestImage(id: string) {
  return GET(new Request(`https://example.test/api/public/media/${id}`), { params: Promise.resolve({ id }) });
}
beforeEach(() => {
  process.env.DATA_BACKEND = "memory";
  globalThis.__tingtingDemoMedia = [];
  store.reset();
  resetRepositoryForTests();
});

describe("memory upload public image delivery", () => {
  it("does not expose drafts, and serves real image bytes after publication", async () => {
    const asset = await imageFixture();
    expect((await requestImage(asset.id)).status).toBe(404);
    promoteDemoMedia([asset.id]);
    const response = await requestImage(asset.id);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/webp");
    expect(await sharp(Buffer.from(await response.arrayBuffer())).metadata()).toMatchObject({ format: "webp", width: 800, height: 600 });
    expect((await requestImage("missing")).status).toBe(404);
  });

  it("repairs existing published inline-image snapshots when reading public pages", async () => {
    const asset = await imageFixture();
    const initial = store.getRental("20000000-0000-4000-8000-000000000002");
    const input = rentalToV2(initial);
    input.property.provinceCode = "BC";
    input.images = [{ mediaAssetId: asset.id, sortOrder: 0, isCover: true }];
    const draft = store.updateRental(initial.id, input, initial.updatedAt);
    store.setRentalStatus(draft.id, "publish", draft.updatedAt);
    const legacySnapshot = globalThis.__tingtingMemoryState!.rentalPublishedSnapshots[draft.id];
    legacySnapshot.coverImageUrl = getDemoMediaAsset(asset.id)!.dataUrl;
    legacySnapshot.images[0].url = legacySnapshot.coverImageUrl;

    const detail = await loadPublicRentalDetailData(draft.slug);
    expect(detail?.rental.images[0].url).toBe(`/api/public/media/${asset.id}`);
    expect(detail?.rental.coverImageUrl).toBe(`/api/public/media/${asset.id}`);
    expect(store.listRentals(false).find(rental => rental.id === draft.id)?.coverImageUrl).toBe(`/api/public/media/${asset.id}`);
  });

  it("does not serve memory assets from the production storage backend", async () => {
    const asset = await imageFixture();
    promoteDemoMedia([asset.id]);
    vi.stubEnv("DATA_BACKEND", "supabase");
    try { expect((await requestImage(asset.id)).status).toBe(404); }
    finally { vi.unstubAllEnvs(); }
  });
});
