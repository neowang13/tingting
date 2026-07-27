"use client";

import Image from "next/image";
import { FormEvent, useState } from "react";
import type { MediaAsset } from "@/lib/contracts";

export function MediaLibrary({
  assets,
  onAssetsChanged
}: {
  assets: MediaAsset[];
  onAssetsChanged: (assets: MediaAsset[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("Validating and uploading image…");
    try {
      const response = await fetch("/api/admin/media", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error?.message ?? "Image could not be uploaded.");
      onAssetsChanged([result.data, ...assets]);
      setMessage("Image uploaded as a private draft.");
      event.currentTarget.reset();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Image could not be uploaded.");
    } finally {
      setBusy(false);
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
      <summary>Media library · {assets.length} available assets</summary>
      <form className="media-upload" onSubmit={upload}>
        <label className="field"><span>Image file</span><input name="file" type="file" accept="image/jpeg,image/png,image/webp,image/avif" required /></label>
        <label className="field"><span>Alt text</span><input name="altText" maxLength={160} required /></label>
        <button className="button secondary" disabled={busy} type="submit">Upload private draft</button>
      </form>
      <p className="field-help">JPEG, PNG, WebP, or AVIF · maximum 8 MB · dimensions 64–8,000 px.</p>
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
      <p className="admin-save-status" aria-live="polite">{message}</p>
    </details>
  );
}
