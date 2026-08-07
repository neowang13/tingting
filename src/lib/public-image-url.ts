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
