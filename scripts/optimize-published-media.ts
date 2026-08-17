import { createClient } from "@supabase/supabase-js";
import { optimizeImageForWeb } from "../src/features/content/image-optimization";
import type { ValidatedImage } from "../src/features/content/image-validation";

const apply = process.argv.includes("--apply");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const publicBucket = process.env.SUPABASE_STORAGE_PUBLIC_BUCKET ?? "site-media";

if (!url || !serviceRoleKey) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
}

const client = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function downloadWithRetry(path: string) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const result = await client.storage.from(publicBucket).download(path);
    if (!result.error) return result.data;
    if (attempt === 3) throw result.error;
    await wait(attempt * 500);
  }
  throw new Error("Download retry failed.");
}

function sourceImage(bytes: Uint8Array, width: number, height: number): ValidatedImage {
  return {
    mimeType: "image/jpeg",
    extension: "jpg",
    width,
    height,
    bytes
  };
}

async function main() {
  const { data, error } = await client
    .from("media_assets")
    .select("id,byte_size,width,height,published_storage_path")
    .eq("state", "published")
    .not("published_storage_path", "is", null)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Could not read published media: ${error.message}`);

  let originalBytes = 0;
  let optimizedBytes = 0;
  let changed = 0;

  for (const row of data ?? []) {
    if (!row.published_storage_path) continue;
    if (row.published_storage_path.endsWith(".webp")) continue;
    let downloaded: Blob;
    try {
      downloaded = await downloadWithRetry(row.published_storage_path);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Could not download media ${row.id}: ${message}`);
    }
    const bytes = new Uint8Array(await downloaded.arrayBuffer());
    const optimized = await optimizeImageForWeb(
      sourceImage(bytes, Number(row.width), Number(row.height))
    );
    originalBytes += bytes.length;
    optimizedBytes += optimized.bytes.length;
    changed += 1;

    if (!apply) continue;

    const publishedPath = `published/${row.id}/${row.id}.webp`;
    const uploaded = await client.storage.from(publicBucket).upload(publishedPath, optimized.bytes, {
      contentType: optimized.mimeType,
      cacheControl: "31536000",
      upsert: true
    });
    if (uploaded.error) {
      throw new Error(`Could not upload optimized media ${row.id}: ${uploaded.error.message}`);
    }
    const publicUrl = client.storage.from(publicBucket).getPublicUrl(publishedPath).data.publicUrl;
    const updated = await client
      .from("media_assets")
      .update({
        published_storage_path: publishedPath,
        public_url: publicUrl,
        mime_type: optimized.mimeType,
        byte_size: optimized.bytes.length,
        width: optimized.width,
        height: optimized.height
      })
      .eq("id", row.id);
    if (updated.error) {
      throw new Error(`Could not update media ${row.id}: ${updated.error.message}`);
    }
  }

  const savedPercent = originalBytes
    ? Math.round((1 - optimizedBytes / originalBytes) * 100)
    : 0;
  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    assets: changed,
    originalBytes,
    optimizedBytes,
    savedPercent
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
