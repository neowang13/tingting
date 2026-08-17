import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { optimizeImageForWeb, PUBLIC_IMAGE_MAX_EDGE } from "@/features/content/image-optimization";
import { validateImageFile } from "@/features/content/image-validation";

describe("public image optimization", () => {
  it("converts uploads to bounded WebP images", async () => {
    const source = await sharp({
      create: { width: 3_000, height: 1_500, channels: 3, background: "#88aa99" }
    }).png().toBuffer();
    const image = await validateImageFile(new File([Uint8Array.from(source)], "large.png", { type: "image/png" }));

    const optimized = await optimizeImageForWeb(image);

    expect(optimized.mimeType).toBe("image/webp");
    expect(optimized.extension).toBe("webp");
    expect(optimized.width).toBe(PUBLIC_IMAGE_MAX_EDGE);
    expect(optimized.height).toBe(1_000);
    expect(optimized.bytes.length).toBeLessThan(source.length);
  });
});
