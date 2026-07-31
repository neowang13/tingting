"use client";

import { Heart } from "lucide-react";
import { useSyncExternalStore } from "react";

const storageKey = "tingting-saved-rentals";
const changeEvent = "tingting-saved-rentals-change";

export function SaveListingButton({ slug }: { slug: string }) {
  const saved = useSyncExternalStore(
    subscribeToSavedListings,
    () => readSavedListings().includes(slug),
    () => false
  );

  function toggleSaved() {
    const listings = readSavedListings();
    const next = listings.includes(slug)
      ? listings.filter((listing) => listing !== slug)
      : [...listings, slug];
    window.localStorage.setItem(storageKey, JSON.stringify(next));
    window.dispatchEvent(new Event(changeEvent));
  }

  return (
    <button
      className={`button secondary rental-save-button${saved ? " saved" : ""}`}
      type="button"
      aria-pressed={saved}
      onClick={toggleSaved}
    >
      {saved ? "Saved" : "Save listing"}
      <Heart aria-hidden fill={saved ? "currentColor" : "none"} />
    </button>
  );
}

function subscribeToSavedListings(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(changeEvent, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(changeEvent, onStoreChange);
  };
}

function readSavedListings() {
  try {
    const value = JSON.parse(window.localStorage.getItem(storageKey) ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}
