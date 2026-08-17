import type { RentalListing } from "@/lib/contracts";

function configuredDevelopmentSupabaseOrigin() {
  if (process.env.NODE_ENV !== "development") return null;
  const configured = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!configured) return null;
  try {
    return new URL(configured).origin;
  } catch {
    return null;
  }
}

export function sanitizePublicImageUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")) {
    return value;
  }

  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password) return null;
    if (parsed.protocol === "https:" && parsed.hostname === "images.unsplash.com") return value;
    const isPublicSupabaseObject = parsed.pathname.startsWith("/storage/v1/object/public/");
    if (
      isPublicSupabaseObject
      && parsed.protocol === "https:"
      && parsed.hostname.endsWith(".supabase.co")
      && parsed.hostname !== "supabase.co"
    ) return value;
    if (isPublicSupabaseObject && parsed.origin === configuredDevelopmentSupabaseOrigin()) return value;
  } catch {
    return null;
  }

  return null;
}

export function shouldServePublicImageDirectly(value: string | null | undefined): boolean {
  const safeValue = sanitizePublicImageUrl(value);
  if (!safeValue) return false;
  try {
    const parsed = new URL(safeValue);
    return (
      parsed.hostname === "images.unsplash.com"
      || parsed.pathname.startsWith("/storage/v1/object/public/")
    );
  } catch {
    return false;
  }
}

export function refreshPublicRentalMediaUrls(
  rental: RentalListing,
  mediaUrls: Record<string, string | null>
): RentalListing {
  const images = rental.images.map((image) => ({
    ...image,
    url: mediaUrls[image.mediaAssetId] ?? image.url
  }));
  return {
    ...rental,
    images,
    coverImageUrl: images.find((image) => image.isCover)?.url ?? rental.coverImageUrl
  };
}

export function sanitizePublicRentalImages(rental: RentalListing): RentalListing {
  return {
    ...rental,
    coverImageUrl: sanitizePublicImageUrl(rental.coverImageUrl),
    images: rental.images.map((image) => ({
      ...image,
      url: sanitizePublicImageUrl(image.url)
    }))
  };
}
