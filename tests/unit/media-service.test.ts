import { afterEach, beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  archiveMediaAsset,
  listMediaAssets,
  promoteDemoMedia,
  updateMediaAltText,
  uploadMediaAsset
} from "../../src/features/content/media-service";

async function pngFixture() {
  const bytes = await sharp({
    create: { width: 800, height: 600, channels: 3, background: "#2d725c" }
  }).png().toBuffer();
  return new File([Uint8Array.from(bytes)], "fixture.png", { type: "image/png" });
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
    const uploaded = await uploadMediaAsset(await pngFixture(), "Original alt", crypto.randomUUID());
    expect(uploaded).toMatchObject({ mimeType: "image/webp", width: 800, height: 600 });
    await expect(updateMediaAltText(uploaded.id, "Updated alt")).resolves.toMatchObject({
      altText: "Updated alt"
    });
    await archiveMediaAsset(uploaded.id);
    await expect(listMediaAssets()).resolves.toEqual([]);
  });

  it("protects media after publication", async () => {
    const uploaded = await uploadMediaAsset(await pngFixture(), "Published image", crypto.randomUUID());
    promoteDemoMedia([uploaded.id]);
    await expect(archiveMediaAsset(uploaded.id)).rejects.toMatchObject({ code: "MEDIA_IN_USE" });
  });
});
