import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  archiveMediaAsset,
  listMediaAssets,
  promoteDemoMedia,
  updateMediaAltText,
  uploadMediaAsset
} from "../../src/features/content/media-service";

function pngFixture() {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  new DataView(bytes.buffer).setUint32(16, 800);
  new DataView(bytes.buffer).setUint32(20, 600);
  return new File([bytes], "fixture.png", { type: "image/png" });
}

describe("media library service", () => {
  const originalBackend = process.env.DATA_BACKEND;

  beforeEach(() => {
    process.env.DATA_BACKEND = "memory";
    globalThis.__tingtingDemoMedia = [];
  });

  afterEach(() => {
    process.env.DATA_BACKEND = originalBackend;
    globalThis.__tingtingDemoMedia = undefined;
  });

  it("updates alt text and archives only private drafts", async () => {
    const uploaded = await uploadMediaAsset(pngFixture(), "Original alt", crypto.randomUUID());
    await expect(updateMediaAltText(uploaded.id, "Updated alt")).resolves.toMatchObject({
      altText: "Updated alt"
    });
    await archiveMediaAsset(uploaded.id);
    await expect(listMediaAssets()).resolves.toEqual([]);
  });

  it("protects media after publication", async () => {
    const uploaded = await uploadMediaAsset(pngFixture(), "Published image", crypto.randomUUID());
    promoteDemoMedia([uploaded.id]);
    await expect(archiveMediaAsset(uploaded.id)).rejects.toMatchObject({ code: "MEDIA_IN_USE" });
  });
});
