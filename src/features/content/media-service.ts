import { createClient } from "@supabase/supabase-js";
import { validateImageFile } from "@/features/content/image-validation";
import { optimizeImageForWeb } from "@/features/content/image-optimization";
import { ApiError } from "@/lib/api";
import type { MediaAsset } from "@/lib/contracts";

interface DemoMediaAsset extends MediaAsset {
  dataUrl: string;
}

declare global {
  var __tingtingDemoMedia: DemoMediaAsset[] | undefined;
}

function demoMedia() {
  globalThis.__tingtingDemoMedia ??= [];
  return globalThis.__tingtingDemoMedia;
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new ApiError(503, "SUPABASE_NOT_CONFIGURED", "Media storage is not configured.");
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function listMediaAssets(): Promise<MediaAsset[]> {
  if (process.env.DATA_BACKEND !== "supabase") {
    return demoMedia().filter((asset) => asset.state !== "archived").map((asset) => ({
      id: asset.id,
      state: asset.state,
      originalFilename: asset.originalFilename,
      mimeType: asset.mimeType,
      byteSize: asset.byteSize,
      width: asset.width,
      height: asset.height,
      altText: asset.altText,
      previewUrl: asset.previewUrl,
      publicUrl: asset.publicUrl,
      createdAt: asset.createdAt
    }));
  }
  const client = serviceClient();
  const { data, error } = await client
    .from("media_assets")
    .select("*")
    .neq("state", "archived")
    .order("created_at", { ascending: false });
  if (error) throw new ApiError(500, "MEDIA_LIST_FAILED", "Media assets could not be loaded.");

  return Promise.all((data ?? []).map(async (row) => {
    let previewUrl = row.public_url as string | null;
    if (!previewUrl && row.draft_storage_path) {
      const { data: signed } = await client.storage
        .from(process.env.SUPABASE_STORAGE_DRAFT_BUCKET ?? "site-media-drafts")
        .createSignedUrl(row.draft_storage_path, 15 * 60);
      previewUrl = signed?.signedUrl ?? null;
    }
    return {
      id: row.id,
      state: row.state,
      originalFilename: row.original_filename,
      mimeType: row.mime_type,
      byteSize: Number(row.byte_size),
      width: Number(row.width),
      height: Number(row.height),
      altText: row.alt_text,
      previewUrl,
      publicUrl: row.public_url,
      createdAt: row.created_at
    } as MediaAsset;
  }));
}

export async function uploadMediaAsset(file: File, altText: string, actorId: string): Promise<MediaAsset> {
  const alt = altText.trim();
  if (!alt || alt.length > 160) {
    throw new ApiError(400, "ALT_TEXT_REQUIRED", "Alt text is required and must be 160 characters or fewer.");
  }
  const image = await optimizeImageForWeb(await validateImageFile(file));
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  if (process.env.DATA_BACKEND !== "supabase") {
    const dataUrl = `data:${image.mimeType};base64,${Buffer.from(image.bytes).toString("base64")}`;
    const asset: DemoMediaAsset = {
      id,
      state: "draft",
      originalFilename: file.name,
      mimeType: image.mimeType,
      byteSize: image.bytes.length,
      width: image.width,
      height: image.height,
      altText: alt,
      previewUrl: dataUrl,
      publicUrl: null,
      createdAt,
      dataUrl
    };
    demoMedia().unshift(asset);
    return asset;
  }

  const client = serviceClient();
  const draftBucket = process.env.SUPABASE_STORAGE_DRAFT_BUCKET ?? "site-media-drafts";
  const path = `draft/${id}.${image.extension}`;
  const { error: uploadError } = await client.storage.from(draftBucket).upload(path, image.bytes, {
    contentType: image.mimeType,
    cacheControl: "31536000",
    upsert: false
  });
  if (uploadError) throw new ApiError(502, "MEDIA_UPLOAD_FAILED", "The image could not be uploaded.");

  const { data, error } = await client
    .from("media_assets")
    .insert({
      id,
      draft_storage_path: path,
      original_filename: file.name,
      mime_type: image.mimeType,
      byte_size: image.bytes.length,
      width: image.width,
      height: image.height,
      alt_text: alt,
      created_by: actorId
    })
    .select("*")
    .single();
  if (error) {
    await client.storage.from(draftBucket).remove([path]);
    throw new ApiError(500, "MEDIA_RECORD_FAILED", "The image record could not be created.");
  }
  const { data: signed } = await client.storage.from(draftBucket).createSignedUrl(path, 15 * 60);
  return {
    id: data.id,
    state: data.state,
    originalFilename: data.original_filename,
    mimeType: data.mime_type,
    byteSize: Number(data.byte_size),
    width: Number(data.width),
    height: Number(data.height),
    altText: data.alt_text,
    previewUrl: signed?.signedUrl ?? null,
    publicUrl: null,
    createdAt: data.created_at
  };
}

export async function archiveMediaAsset(id: string) {
  if (process.env.DATA_BACKEND !== "supabase") {
    const asset = demoMedia().find((item) => item.id === id);
    if (!asset) throw new ApiError(404, "MEDIA_NOT_FOUND", "Media asset was not found.");
    if (asset.state === "published") {
      throw new ApiError(409, "MEDIA_IN_USE", "Published media cannot be archived.");
    }
    asset.state = "archived";
    return;
  }
  const client = serviceClient();
  const { data: sections, error: sectionError } = await client
    .from("site_sections")
    .select("draft_content,published_content");
  if (sectionError) {
    throw new ApiError(500, "MEDIA_REFERENCE_CHECK_FAILED", "Media references could not be checked.");
  }
  const referencedByContent = (sections ?? []).some((section) =>
    collectMediaAssetIds([section.draft_content, section.published_content]).includes(id)
  );
  const { count } = await client
    .from("rental_listing_images")
    .select("id", { count: "exact", head: true })
    .eq("media_asset_id", id);
  if (referencedByContent || (count ?? 0) > 0) {
    throw new ApiError(409, "MEDIA_IN_USE", "Media referenced by published content cannot be archived.");
  }
  const { data, error } = await client
    .from("media_assets")
    .update({ state: "archived", archived_at: new Date().toISOString() })
    .eq("id", id)
    .neq("state", "published")
    .select("id")
    .maybeSingle();
  if (error) throw new ApiError(500, "MEDIA_ARCHIVE_FAILED", "The media asset could not be archived.");
  if (!data) throw new ApiError(409, "MEDIA_IN_USE", "Published media cannot be archived.");
}

export async function updateMediaAltText(id: string, altText: unknown): Promise<MediaAsset> {
  if (typeof altText !== "string" || !altText.trim() || altText.trim().length > 160) {
    throw new ApiError(400, "ALT_TEXT_REQUIRED", "Alt text is required and must be 160 characters or fewer.");
  }
  const alt = altText.trim();
  if (process.env.DATA_BACKEND !== "supabase") {
    const asset = demoMedia().find((item) => item.id === id && item.state !== "archived");
    if (!asset) throw new ApiError(404, "MEDIA_NOT_FOUND", "Media asset was not found.");
    asset.altText = alt;
    return { ...asset };
  }
  const client = serviceClient();
  const { data, error } = await client
    .from("media_assets")
    .update({ alt_text: alt })
    .eq("id", id)
    .neq("state", "archived")
    .select("*")
    .maybeSingle();
  if (error) throw new ApiError(500, "MEDIA_UPDATE_FAILED", "The media asset could not be updated.");
  if (!data) throw new ApiError(404, "MEDIA_NOT_FOUND", "Media asset was not found.");
  const assets = await listMediaAssets();
  const updated = assets.find((asset) => asset.id === data.id);
  if (!updated) throw new ApiError(500, "MEDIA_UPDATE_FAILED", "The media asset could not be updated.");
  return updated;
}

export function resolveDemoMedia(id: string) {
  const asset = demoMedia().find((item) => item.id === id && item.state === "published");
  return asset?.dataUrl ?? null;
}

export function getDemoMediaAsset(id: string) {
  return demoMedia().find((item) => item.id === id) ?? null;
}

export function promoteDemoMedia(ids: string[]) {
  for (const id of ids) {
    const asset = demoMedia().find((item) => item.id === id);
    if (asset) {
      asset.state = "published";
      asset.publicUrl = asset.dataUrl;
      asset.previewUrl = asset.dataUrl;
    }
  }
}

export function collectMediaAssetIds(value: unknown): string[] {
  const ids = new Set<string>();
  function visit(current: unknown) {
    if (Array.isArray(current)) return current.forEach(visit);
    if (!current || typeof current !== "object") return;
    for (const [key, child] of Object.entries(current as Record<string, unknown>)) {
      if (key === "mediaAssetId" && typeof child === "string") ids.add(child);
      else visit(child);
    }
  }
  visit(value);
  return [...ids];
}
