"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { MediaLibrary } from "@/components/admin/media-library";
import type { MediaAsset, RentalListing } from "@/lib/contracts";

export function RentalEditor({
  rental,
  initialMedia,
  sourceMarker
}: {
  rental: RentalListing | null;
  initialMedia: MediaAsset[];
  sourceMarker?: { sourceSystem: string | null; externalReference: string | null };
}) {
  const router = useRouter();
  const [current, setCurrent] = useState(rental);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(rental ? "No unsaved changes." : "Complete the required fields.");
  const [media, setMedia] = useState(initialMedia);
  const [selectedImages, setSelectedImages] = useState(
    rental ? [...rental.images].sort((a, b) => a.sortOrder - b.sortOrder).map((image) => image.mediaAssetId) : []
  );
  const [coverMediaAssetId, setCoverMediaAssetId] = useState(
    rental?.images.find((image) => image.isCover)?.mediaAssetId ?? ""
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = {
      slug: String(form.get("slug")),
      title: String(form.get("title")),
      addressLine: String(form.get("addressLine")),
      neighbourhood: String(form.get("neighbourhood")) || null,
      city: String(form.get("city")),
      monthlyRentCents: Math.round(Number(form.get("monthlyRent")) * 100),
      bedrooms: Number(form.get("bedrooms")),
      bathrooms: Number(form.get("bathrooms")),
      squareFeet: form.get("squareFeet") ? Number(form.get("squareFeet")) : null,
      availableOn: String(form.get("availableOn")) || null,
      petPolicy: String(form.get("petPolicy")) || null,
      description: String(form.get("description")),
      sortOrder: Number(form.get("sortOrder")),
      coverImageUrl: rental?.coverImageUrl ?? null,
      images: selectedImages.map((mediaAssetId, index) => ({
        mediaAssetId,
        sortOrder: index,
        isCover: mediaAssetId === coverMediaAssetId
      }))
    };

    setBusy(true);
    setMessage("Saving…");
    try {
      const response = await fetch(current ? `/api/admin/rentals/${current.id}` : "/api/admin/rentals", {
        method: current ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(current ? { rental: payload, expectedVersion: current.updatedAt } : payload)
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error?.message ?? "Rental could not be saved.");
      setCurrent(result.data);
      setMessage("Rental saved.");
      if (!current) router.replace(`/admin/rentals/${result.data.id}`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Rental could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function statusAction(action: "publish" | "unpublish" | "archive") {
    if (!current) return;
    const label = action === "publish" ? "publish this rental" : `${action} this rental`;
    if (!window.confirm(`Are you sure you want to ${label}?`)) return;
    setBusy(true);
    setMessage("Updating status…");
    try {
      const response = await fetch(`/api/admin/rentals/${current.id}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedVersion: current.updatedAt })
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error?.message ?? "Status could not be updated.");
      setCurrent(result.data);
      setMessage(`Rental is now ${result.data.status}.`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Status could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-editor-stack">
      <MediaLibrary assets={media} onAssetsChanged={setMedia} />
      <form className="card admin-form" onSubmit={submit}>
      {sourceMarker?.sourceSystem && (
        <p className="source-marker">
          Source: {sourceMarker.sourceSystem === "openclaw" ? "OpenClaw Operations" : sourceMarker.sourceSystem}
          {sourceMarker.externalReference ? ` · ${sourceMarker.externalReference}` : ""}
        </p>
      )}
      <div className="admin-card-heading">
        <div>
          <p className="eyebrow">RENTAL LISTING</p>
          <h2>{current ? current.title : "New rental"}</h2>
        </div>
        <span className={`status ${current?.status ?? "draft"}`}>{current?.status ?? "Draft"}</span>
      </div>
      <div className="field-grid">
        <label className="field">
          <span>URL slug</span>
          <input name="slug" required readOnly={Boolean(current?.publishedAt)} defaultValue={current?.slug} />
          {current?.publishedAt && <small>Fixed after first publish.</small>}
        </label>
        <label className="field"><span>Listing title</span><input name="title" required defaultValue={current?.title} /></label>
        <label className="field field-wide"><span>Address</span><input name="addressLine" required defaultValue={current?.addressLine} /></label>
        <label className="field"><span>Neighbourhood</span><input name="neighbourhood" defaultValue={current?.neighbourhood ?? ""} /></label>
        <label className="field"><span>City</span><input name="city" required defaultValue={current?.city ?? "Vancouver"} /></label>
        <label className="field"><span>Monthly rent (CAD)</span><input name="monthlyRent" type="number" min="1" step="0.01" required defaultValue={current ? current.monthlyRentCents / 100 : ""} /></label>
        <label className="field"><span>Bedrooms</span><input name="bedrooms" type="number" min="0" step="0.5" required defaultValue={current?.bedrooms ?? 1} /></label>
        <label className="field"><span>Bathrooms</span><input name="bathrooms" type="number" min="0" step="0.5" required defaultValue={current?.bathrooms ?? 1} /></label>
        <label className="field"><span>Square feet</span><input name="squareFeet" type="number" min="1" defaultValue={current?.squareFeet ?? ""} /></label>
        <label className="field"><span>Available date</span><input name="availableOn" type="date" defaultValue={current?.availableOn ?? ""} /></label>
        <label className="field"><span>Homepage order</span><input name="sortOrder" type="number" defaultValue={current?.sortOrder ?? 0} /></label>
        <label className="field field-wide"><span>Pet policy</span><input name="petPolicy" defaultValue={current?.petPolicy ?? ""} /></label>
        <label className="field field-wide"><span>Description</span><textarea name="description" rows={7} required defaultValue={current?.description} /></label>
      </div>
      <fieldset className="field-group rental-images">
        <legend>Rental images</legend>
        <p className="field-help">Select up to 20 images, choose exactly one cover, and adjust their public order.</p>
        <div className="media-grid">
          {media.map((asset) => {
            const selected = selectedImages.includes(asset.id);
            return (
              <article className={`media-card selectable ${selected ? "selected" : ""}`} key={asset.id}>
                {asset.previewUrl ? (
                  <Image src={asset.previewUrl} alt={asset.altText} width={240} height={150} unoptimized={asset.previewUrl.startsWith("data:")} />
                ) : <div className="media-placeholder">Preview unavailable</div>}
                <div>
                  <label className="check-field">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={(event) => {
                        setSelectedImages((items) => event.target.checked
                          ? [...items, asset.id]
                          : items.filter((id) => id !== asset.id)
                        );
                        if (!event.target.checked && coverMediaAssetId === asset.id) setCoverMediaAssetId("");
                      }}
                    />
                    Use image
                  </label>
                  {selected && (
                    <>
                      <label className="radio-field">
                        <input
                          type="radio"
                          name="coverMediaAssetId"
                          checked={coverMediaAssetId === asset.id}
                          onChange={() => setCoverMediaAssetId(asset.id)}
                        />
                        Cover image
                      </label>
                      <div className="image-order-actions">
                        <button className="icon-text-button" type="button" onClick={() => moveImage(asset.id, -1, selectedImages, setSelectedImages)}>Move earlier</button>
                        <button className="icon-text-button" type="button" onClick={() => moveImage(asset.id, 1, selectedImages, setSelectedImages)}>Move later</button>
                      </div>
                    </>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </fieldset>
      <div className="admin-action-bar">
        <button className="button secondary" disabled={busy} type="submit">Save draft</button>
        {current && current.status !== "published" && current.status !== "archived" && (
          <button className="button" disabled={busy} type="button" onClick={() => void statusAction("publish")}>Publish</button>
        )}
        {current?.status === "published" && (
          <button className="button secondary" disabled={busy} type="button" onClick={() => void statusAction("unpublish")}>Unpublish</button>
        )}
        {current && current.status !== "archived" && (
          <button className="button danger-outline" disabled={busy} type="button" onClick={() => void statusAction("archive")}>Archive</button>
        )}
      </div>
      <p className="admin-save-status" aria-live="polite">{message}</p>
      </form>
    </div>
  );
}

function moveImage(
  id: string,
  direction: -1 | 1,
  images: string[],
  setImages: (images: string[]) => void
) {
  const index = images.indexOf(id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= images.length) return;
  const next = [...images];
  [next[index], next[target]] = [next[target], next[index]];
  setImages(next);
}
