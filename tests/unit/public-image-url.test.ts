import { afterEach, describe, expect, it, vi } from "vitest";
import { demoRentals } from "@/data/demo";
import {
  sanitizePublicImageUrl,
  sanitizePublicRentalImages
} from "@/lib/public-image-url";

describe("public rental image URL boundary", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("allows only application-relative, Unsplash, and Supabase Cloud URLs", () => {
    expect(sanitizePublicImageUrl("/images/rental.jpg")).toBe("/images/rental.jpg");
    expect(sanitizePublicImageUrl("https://images.unsplash.com/photo-1?w=1200"))
      .toBe("https://images.unsplash.com/photo-1?w=1200");
    expect(sanitizePublicImageUrl("https://project-ref.supabase.co/storage/v1/object/public/rentals/a.jpg"))
      .toBe("https://project-ref.supabase.co/storage/v1/object/public/rentals/a.jpg");

    expect(sanitizePublicImageUrl("https://project-ref.supabase.co/storage/v1/object/sign/private/a.jpg?token=secret"))
      .toBeNull();
    expect(sanitizePublicImageUrl("https://project-ref.supabase.co/functions/v1/not-an-image"))
      .toBeNull();
    expect(sanitizePublicImageUrl("https://example.test/rentals/rental-v2.jpg")).toBeNull();
    expect(sanitizePublicImageUrl("//example.test/rental.jpg")).toBeNull();
    expect(sanitizePublicImageUrl("javascript:alert(1)")).toBeNull();
    expect(sanitizePublicImageUrl(null)).toBeNull();
  });

  it("configures next/image for the development Supabase origin", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.resetModules();

    const config = (await import("../../next.config")).default;

    expect(config.images?.remotePatterns).toContainEqual(expect.objectContaining({
      protocol: "http",
      hostname: "127.0.0.1",
      port: "54321"
    }));
  });

  it("allows the configured local Supabase origin only outside production", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NODE_ENV", "development");
    const local = "http://127.0.0.1:54321/storage/v1/object/public/rentals/a.jpg";
    expect(sanitizePublicImageUrl(local)).toBe(local);
    expect(sanitizePublicImageUrl("http://127.0.0.1:54321/storage/v1/object/sign/private/a.jpg?token=secret"))
      .toBeNull();
    expect(sanitizePublicImageUrl("http://localhost:54321/storage/v1/object/public/rentals/a.jpg"))
      .toBeNull();

    vi.stubEnv("NODE_ENV", "production");
    expect(sanitizePublicImageUrl(local)).toBeNull();
  });

  it("removes unsafe cover and gallery URLs from public rental projections", () => {
    const sanitized = sanitizePublicRentalImages({
      ...demoRentals[0],
      coverImageUrl: "https://example.test/rentals/rental-v2.jpg",
      images: [
        {
          mediaAssetId: crypto.randomUUID(),
          url: "https://example.test/rentals/rental-v2.jpg",
          alt: "Unsafe",
          sortOrder: 0,
          isCover: true
        },
        {
          mediaAssetId: crypto.randomUUID(),
          url: "/images/safe-rental.jpg",
          alt: "Safe",
          sortOrder: 1,
          isCover: false
        }
      ]
    });

    expect(sanitized.coverImageUrl).toBeNull();
    expect(sanitized.images.map((image) => image.url)).toEqual([null, "/images/safe-rental.jpg"]);
  });
});
