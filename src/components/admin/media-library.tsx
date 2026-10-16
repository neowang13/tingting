"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { Upload } from "lucide-react";
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
  showExistingAssets = true,
  maximumFiles = 20,
  disabled = false,
  onBusyChange
}: {
  assets: MediaAsset[];
  onAssetsChanged: (assets: MediaAsset[]) => void;
  summaryLabel?: string;
  showExistingAssets?: boolean;
  maximumFiles?: number;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [open, setOpen] = useState(!showExistingAssets);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const uploadingRef = useRef(false);
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const previewUrls = useRef<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => previewUrls.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  async function uploadFiles(chosenFiles: File[]) {
    if (uploadingRef.current || disabled || chosenFiles.length === 0) return;
    const limit = Math.max(0, Math.min(20, maximumFiles));
    if (chosenFiles.length > limit) {
      setMessage(limit === 0 ? "Remove a photo before adding another. A property can have up to 20 photos."
        : `Choose up to ${limit} more photo${limit === 1 ? "" : "s"}. A property can have up to 20 photos.`);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    previewUrls.current.forEach((url) => URL.revokeObjectURL(url));
    const images = chosenFiles.map((file) => ({
      id: crypto.randomUUID(), file, previewUrl: URL.createObjectURL(file), altText: defaultAltText(file.name)
    }));
    previewUrls.current = images.map((image) => image.previewUrl);
    setPendingImages(images);
    uploadingRef.current = true;
    setBusy(true);
    onBusyChange?.(true);
    const uploaded: MediaAsset[] = [];
    const failed: PendingImage[] = [];
    const failures: string[] = [];
    try {
      for (const [index, image] of images.entries()) {
        setMessage(`Uploading image ${index + 1} of ${images.length}: ${image.file.name}`);
        const form = new FormData();
        form.set("file", image.file);
        form.set("altText", image.altText);
        try {
          const response = await fetch("/api/admin/media", { method: "POST", body: form });
          const result = await response.json();
          if (!response.ok || !result.success) throw new Error(result.error?.message ?? "Image could not be uploaded.");
          uploaded.push(result.data);
        } catch (error) {
          failed.push(image);
          failures.push(`${image.file.name}: ${error instanceof Error ? error.message : "Image could not be uploaded."}`);
        }
      }
      if (uploaded.length > 0) onAssetsChanged([...uploaded, ...assets]);
      const failedIds = new Set(failed.map((image) => image.id));
      images.filter((image) => !failedIds.has(image.id)).forEach((image) => URL.revokeObjectURL(image.previewUrl));
      previewUrls.current = failed.map((image) => image.previewUrl);
      setPendingImages(failed);
      setMessage(failed.length === 0
        ? `${uploaded.length} image${uploaded.length === 1 ? "" : "s"} uploaded as private drafts.`
        : `${uploaded.length} uploaded; ${failed.length} failed. ${failures.join(" ")}`);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
      uploadingRef.current = false;
      setBusy(false);
      onBusyChange?.(false);
    }
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
        <div className="media-upload-dropzone" role="group" aria-label="Upload photos"
          aria-busy={busy} data-dragging={dragging}
          onDragOver={(event) => { event.preventDefault(); if (!busy && !disabled) setDragging(true); }}
          onDragLeave={(event) => { if (event.target === event.currentTarget) setDragging(false); }}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setDragging(false);
            void uploadFiles(Array.from(event.dataTransfer.files));
          }}>
          <Upload size={26} aria-hidden />
          <strong>Drag photos here or choose files</strong>
          <span>Multiple photos upload automatically. Choose a cover after uploading.</span>
          <button className="button secondary" type="button" disabled={busy || disabled || maximumFiles === 0}
            onClick={() => fileInputRef.current?.click()}>{busy ? "Uploading…" : "Choose photos"}</button>
          <input ref={fileInputRef} className="sr-only" tabIndex={-1} aria-label="Image files"
            type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple disabled={busy || disabled}
            onChange={(event) => void uploadFiles(Array.from(event.currentTarget.files ?? []))} />
        </div>
        {pendingImages.length > 0 && <div className="media-upload-queue" aria-label="Selected images">
          {pendingImages.map((image) => <article className="media-card media-upload-preview" key={image.id}>
            <Image src={image.previewUrl} alt="" width={240} height={150} unoptimized />
            <div><strong>{image.file.name}</strong><small>{Math.ceil(image.file.size / 1024)} KB · {busy ? "Uploading…" : "Upload failed"}</small></div>
          </article>)}
        </div>}
        {!busy && pendingImages.length > 0 && <button className="button secondary" disabled={disabled} type="button"
          onClick={() => void uploadFiles(pendingImages.map((image) => image.file))}>Retry failed uploads</button>}
      </div>
      <p className="field-help">Select or drop up to 20 images at once · JPEG, PNG, WebP, or AVIF · maximum 8 MB each · dimensions 64–8,000 px.</p>
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
    .slice(0, 160) || "Property photo";
}
