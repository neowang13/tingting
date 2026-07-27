"use client";

import Image from "next/image";
import { ChangeEvent, useEffect, useRef, useState } from "react";
import type { MediaAsset } from "@/lib/contracts";

interface PendingImage {
  id: string;
  file: File;
  previewUrl: string;
  altText: string;
}

export function MediaLibrary({
  assets,
  onAssetsChanged,
  summaryLabel,
  showExistingAssets = true
}: {
  assets: MediaAsset[];
  onAssetsChanged: (assets: MediaAsset[]) => void;
  summaryLabel?: string;
  showExistingAssets?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const previewUrls = useRef<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => previewUrls.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  function selectImages(event: ChangeEvent<HTMLInputElement>) {
    previewUrls.current.forEach((url) => URL.revokeObjectURL(url));
    const files = Array.from(event.currentTarget.files ?? []).slice(0, 20);
    const next = files.map((file) => {
      const previewUrl = URL.createObjectURL(file);
      return {
        id: crypto.randomUUID(),
        file,
        previewUrl,
        altText: defaultAltText(file.name)
      };
    });
    previewUrls.current = next.map((image) => image.previewUrl);
    setPendingImages(next);
    setMessage(
      files.length === 0
        ? ""
        : `${files.length} image${files.length === 1 ? "" : "s"} selected. Review the previews and alt text before uploading.`
    );
  }

  async function upload() {
    if (pendingImages.length === 0) {
      setMessage("Choose at least one image.");
      return;
    }
    setBusy(true);
    const uploaded: MediaAsset[] = [];
    const failed: Array<PendingImage & { error: string }> = [];

    for (const [index, image] of pendingImages.entries()) {
      setMessage(`Uploading image ${index + 1} of ${pendingImages.length}: ${image.file.name}`);
      const form = new FormData();
      form.set("file", image.file);
      form.set("altText", image.altText.trim());
      try {
        const response = await fetch("/api/admin/media", { method: "POST", body: form });
        const result = await response.json();
        if (!response.ok || !result.success) {
          throw new Error(result.error?.message ?? "Image could not be uploaded.");
        }
        uploaded.push(result.data);
      } catch (error) {
        failed.push({
          ...image,
          error: error instanceof Error ? error.message : "Image could not be uploaded."
        });
      }
    }

    if (uploaded.length > 0) onAssetsChanged([...uploaded.reverse(), ...assets]);

    const failedIds = new Set(failed.map((image) => image.id));
    pendingImages
      .filter((image) => !failedIds.has(image.id))
      .forEach((image) => URL.revokeObjectURL(image.previewUrl));
    const remaining = failed.map((image) => ({
      id: image.id,
      file: image.file,
      previewUrl: image.previewUrl,
      altText: image.altText
    }));
    previewUrls.current = remaining.map((image) => image.previewUrl);
    setPendingImages(remaining);

    if (failed.length === 0) {
      if (fileInputRef.current) fileInputRef.current.value = "";
      setMessage(`${uploaded.length} image${uploaded.length === 1 ? "" : "s"} uploaded as private drafts.`);
    } else {
      setMessage(
        `${uploaded.length} uploaded; ${failed.length} failed. ${failed.map((image) => `${image.file.name}: ${image.error}`).join(" ")}`
      );
    }
    setBusy(false);
  }

  async function updateAltText(asset: MediaAsset, altText: string) {
    setMessage("Saving alt text…");
    const response = await fetch(`/api/admin/media/${asset.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ altText })
    });
    const result = await response.json();
    if (!response.ok || !result.success) {
      setMessage(result.error?.message ?? "Alt text could not be saved.");
      return;
    }
    onAssetsChanged(assets.map((item) => item.id === asset.id ? result.data : item));
    setMessage("Alt text saved.");
  }

  async function archive(asset: MediaAsset) {
    if (!window.confirm(`Archive the private draft “${asset.originalFilename}”?`)) return;
    setMessage("Archiving draft…");
    const response = await fetch(`/api/admin/media/${asset.id}`, { method: "DELETE" });
    const result = await response.json();
    if (!response.ok || !result.success) {
      setMessage(result.error?.message ?? "The draft could not be archived.");
      return;
    }
    onAssetsChanged(assets.filter((item) => item.id !== asset.id));
    setMessage("Private draft archived.");
  }

  return (
    <details className="media-library card" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{summaryLabel ?? `Media library · ${assets.length} available assets`}</summary>
      <div className="media-upload">
        <label className="field">
          <span>Image files</span>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif"
            multiple
            onChange={selectImages}
          />
        </label>
        <button className="button secondary" disabled={busy || pendingImages.length === 0} type="button" onClick={() => void upload()}>
          {busy
            ? "Uploading…"
            : pendingImages.length > 0
              ? `Upload ${pendingImages.length} image${pendingImages.length === 1 ? "" : "s"}`
              : "Upload images"}
        </button>
        {pendingImages.length > 0 && (
          <div className="media-upload-queue" aria-label="Selected images">
            {pendingImages.map((image) => (
              <article className="media-card media-upload-preview" key={image.id}>
                <Image src={image.previewUrl} alt="" width={240} height={150} unoptimized />
                <div>
                  <strong>{image.file.name}</strong>
                  <small>{Math.ceil(image.file.size / 1024)} KB · Ready to upload</small>
                  <label className="field">
                    <span>Alt text for {image.file.name}</span>
                    <input
                      value={image.altText}
                      maxLength={160}
                      required
                      onChange={(event) => {
                        setPendingImages((images) => images.map((item) =>
                          item.id === image.id ? { ...item, altText: event.target.value } : item
                        ));
                      }}
                    />
                  </label>
                  <button
                    className="button danger"
                    disabled={busy}
                    type="button"
                    onClick={() => {
                      URL.revokeObjectURL(image.previewUrl);
                      previewUrls.current = previewUrls.current.filter((url) => url !== image.previewUrl);
                      setPendingImages((images) => images.filter((item) => item.id !== image.id));
                    }}
                  >
                    Remove
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
      <p className="field-help">Choose up to 20 images at once · JPEG, PNG, WebP, or AVIF · maximum 8 MB each · dimensions 64–8,000 px.</p>
      {showExistingAssets && (
        <div className="media-grid">
          {assets.map((asset) => (
            <article className="media-card" key={asset.id}>
              {asset.previewUrl ? (
                <Image src={asset.previewUrl} alt={asset.altText} width={240} height={150} unoptimized={asset.previewUrl.startsWith("data:")} />
              ) : <div className="media-placeholder">Preview unavailable</div>}
              <div>
                <strong>{asset.originalFilename}</strong>
                <small>
                  {asset.width}×{asset.height} · {Math.ceil(asset.byteSize / 1024)} KB ·{" "}
                  {asset.state === "draft" ? "Private draft" : "Published"}
                </small>
                <label className="field">
                  <span>Alt text for {asset.originalFilename}</span>
                  <input
                    defaultValue={asset.altText}
                    maxLength={160}
                    onBlur={(event) => {
                      if (event.currentTarget.value.trim() !== asset.altText) {
                        void updateAltText(asset, event.currentTarget.value);
                      }
                    }}
                  />
                </label>
                {asset.state === "draft" && (
                  <button className="button danger" type="button" onClick={() => void archive(asset)}>
                    Archive draft
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      <p className="admin-save-status" aria-live="polite">{message}</p>
    </details>
  );
}

function defaultAltText(filename: string) {
  return filename
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}
