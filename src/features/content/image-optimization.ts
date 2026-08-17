import sharp from "sharp";
import type { ValidatedImage } from "@/features/content/image-validation";
import { ApiError } from "@/lib/api";

export const PUBLIC_IMAGE_MAX_EDGE = 2_000;
export const PUBLIC_IMAGE_QUALITY = 80;

export async function optimizeImageForWeb(image: ValidatedImage): Promise<ValidatedImage> {
  try {
    const result = await sharp(Buffer.from(image.bytes), {
      failOn: "warning",
      limitInputPixels: 64_000_000
    })
      .rotate()
      .resize({
        width: PUBLIC_IMAGE_MAX_EDGE,
        height: PUBLIC_IMAGE_MAX_EDGE,
        fit: "inside",
        withoutEnlargement: true
      })
      .webp({ quality: PUBLIC_IMAGE_QUALITY, effort: 4, smartSubsample: true })
      .toBuffer({ resolveWithObject: true });

    if (!result.info.width || !result.info.height) {
      throw new Error("The optimized image has no dimensions.");
    }

    return {
      mimeType: "image/webp",
      extension: "webp",
      width: result.info.width,
      height: result.info.height,
      bytes: new Uint8Array(result.data)
    };
  } catch {
    throw new ApiError(400, "IMAGE_OPTIMIZATION_FAILED", "The image could not be prepared for the website.");
  }
}
