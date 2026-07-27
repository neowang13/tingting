const publicMedia: Record<string, string | null> = {
  // Demo-mode stand-in for the future public media projection. Replace with an
  // approved uploaded hero asset before production launch.
  "10000000-0000-4000-8000-000000000001":
    "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=2200&q=85",
  // No approved standalone Ting Ting portrait is present in the repository.
  "10000000-0000-4000-8000-000000000002": null
};

export function resolveSeededPublicMedia(mediaAssetId: string) {
  return publicMedia[mediaAssetId] ?? null;
}

export function isSeededPublicMedia(mediaAssetId: string) {
  return Object.hasOwn(publicMedia, mediaAssetId);
}
