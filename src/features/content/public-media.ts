const publicMedia: Record<string, string | null> = {
  // Demo-mode stand-in for the future public media projection. Replace with an
  // approved uploaded hero asset before production launch.
  "10000000-0000-4000-8000-000000000001":
    "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=2200&q=85",
  "10000000-0000-4000-8000-000000000002":
    "/images/ting-ting-xu-portrait.jpg",
  "11000000-0000-4000-8000-000000000001":
    "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=2200&q=88",
  "11000000-0000-4000-8000-000000000002":
    "https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=1600&q=84",
  "11000000-0000-4000-8000-000000000003":
    "https://images.unsplash.com/photo-1600566753086-00f18fb6b3ea?auto=format&fit=crop&w=1400&q=84",
  "11000000-0000-4000-8000-000000000004":
    "https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?auto=format&fit=crop&w=1400&q=84",
  "11000000-0000-4000-8000-000000000005":
    "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=1400&q=84",
  "11000000-0000-4000-8000-000000000006":
    "https://images.unsplash.com/photo-1585128792020-803d29415281?auto=format&fit=crop&w=1800&q=86",
  "11000000-0000-4000-8000-000000000007":
    "https://images.unsplash.com/photo-1504307651254-35680f356dfd?auto=format&fit=crop&w=1800&q=86",
  "11000000-0000-4000-8000-000000000008":
    "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=1800&q=86",
  "11000000-0000-4000-8000-000000000009":
    "https://images.unsplash.com/photo-1570129477492-45c003edd2be?auto=format&fit=crop&w=1800&q=86",
  "11000000-0000-4000-8000-000000000010":
    "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1800&q=86",
  "11000000-0000-4000-8000-000000000011":
    "https://images.unsplash.com/photo-1560518883-ce09059eeffa?auto=format&fit=crop&w=1800&q=86",
  "11000000-0000-4000-8000-000000000012":
    "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=2200&q=88",
  "11000000-0000-4000-8000-000000000013":
    "https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=1400&q=84",
  "11000000-0000-4000-8000-000000000014":
    "https://images.unsplash.com/photo-1450101499163-c8848c66ca85?auto=format&fit=crop&w=1400&q=84"
};

export function resolveSeededPublicMedia(mediaAssetId: string) {
  return publicMedia[mediaAssetId] ?? null;
}

export function isSeededPublicMedia(mediaAssetId: string) {
  return Object.hasOwn(publicMedia, mediaAssetId);
}
