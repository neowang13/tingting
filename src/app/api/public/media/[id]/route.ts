import { getDemoMediaAsset } from "@/features/content/media-service";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  // Production uses the public storage bucket. Memory-mode uploads need a
  // same-origin URL so public pages never have to expose inline data URLs.
  if (process.env.DATA_BACKEND === "supabase") return new Response(null, { status: 404 });
  const { id } = await context.params;
  const asset = getDemoMediaAsset(id);
  if (!asset || asset.state !== "published") {
    return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const match = /^data:(image\/(?:webp|png|jpeg|avif));base64,([A-Za-z0-9+/=]+)$/.exec(asset.dataUrl);
  if (!match) return new Response(null, { status: 404 });
  return new Response(Buffer.from(match[2], "base64"), { headers: {
    "Content-Type": match[1],
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff"
  } });
}
