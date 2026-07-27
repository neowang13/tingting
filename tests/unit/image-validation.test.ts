import { describe, expect, it } from "vitest";
import { validateImageFile } from "../../src/features/content/image-validation";

function pngFixture(width: number, height: number) {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return new File([bytes], "fixture.png", { type: "text/plain" });
}

describe("image upload validation", () => {
  it("uses file signatures rather than the browser MIME header", async () => {
    await expect(validateImageFile(pngFixture(800, 600))).resolves.toMatchObject({
      mimeType: "image/png",
      width: 800,
      height: 600
    });
  });

  it("rejects spoofed or unreasonable files", async () => {
    await expect(
      validateImageFile(new File([new Uint8Array([1, 2, 3])], "fake.png", { type: "image/png" }))
    ).rejects.toMatchObject({ code: "INVALID_IMAGE_SIGNATURE" });
    await expect(validateImageFile(pngFixture(20, 20))).rejects.toMatchObject({
      code: "INVALID_IMAGE_DIMENSIONS"
    });
  });
});
