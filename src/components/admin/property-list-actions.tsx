"use client";

import Link from "next/link";
import { usePublishConfirmation } from "@/components/admin/publish-confirmation";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { RentalListing } from "@/lib/contracts";
import type { ViewingScheduleDraft } from "@/features/showings/draft";

export function PropertyListActions({ rental }: {
  rental: Pick<RentalListing, "id" | "title" | "status" | "updatedAt">;
}) {
  const router = useRouter();
  const { showPublishConfirmation, dismissPublishConfirmation } = usePublishConfirmation();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const published = rental.status === "published";
  const base = `/api/admin/rentals/${rental.id}`;

  async function changePublication() {
    dismissPublishConfirmation();
    setBusy(true);
    setMessage("");
    try {
      let payload: Record<string, unknown> = { expectedVersion: rental.updatedAt };
      if (!published) {
        let draft = await readResponse(await fetch(`${base}/viewing-draft`)) as ViewingScheduleDraft;
        // Legacy properties may have a live calendar but no private draft yet.
        // Copy it unchanged so list publication uses the same atomic operation as Edit.
        if (!draft.updatedAt) {
          draft = await readResponse(await fetch(`${base}/viewing-draft`, {
            method: "PATCH", headers: { "content-type": "application/json" },
            body: JSON.stringify({
              timezone: draft.timezone, openWeekdays: draft.openWeekdays, dateOverrides: draft.dateOverrides,
              expectedUpdatedAt: draft.updatedAt, expectedPublishedUpdatedAt: draft.publishedUpdatedAt
            })
          })) as ViewingScheduleDraft;
        }
        payload = { ...payload, expectedViewingDraftVersion: draft.updatedAt,
          expectedViewingPublishedVersion: draft.publishedUpdatedAt };
      }
      await readResponse(await fetch(`${base}/${published ? "unpublish" : "publish"}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload)
      }));
      if (!published) showPublishConfirmation();
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Property status could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="property-list-actions" role="group" aria-label={`Actions for ${rental.title}`}>
    <button className="property-view-action" type="button" disabled={busy} aria-busy={busy}
      onClick={() => void changePublication()}>{published ? "Unpublish" : "Publish"}</button>
    <Link className="property-view-action" href={`/admin/properties/${rental.id}`}>Edit</Link>
    {message && <p className="property-action-message" role="alert">{message}</p>}
  </div>;
}

async function readResponse(response: Response): Promise<unknown> {
  const result = await response.json();
  if (!response.ok || !result.success) {
    const code = result.error?.code;
    if (code === "PUBLISH_REQUIREMENTS_MISSING" || code === "COVER_IMAGE_REQUIRED") {
      throw new Error("Complete the required fields and choose a cover image in Edit before publishing.");
    }
    throw new Error(result.error?.message ?? "Property status could not be updated.");
  }
  return result.data;
}
