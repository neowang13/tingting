"use client";

import Image from "next/image";
import { ChevronLeft, ChevronRight, Images, X } from "lucide-react";
import { useRef, useState } from "react";
import type { RentalImage } from "@/lib/contracts";
import { shouldServePublicImageDirectly } from "@/lib/public-image-url";

export function RentalGallery({
  title,
  city,
  images
}: {
  title: string;
  city: string;
  images: RentalImage[];
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [broken, setBroken] = useState<Set<number>>(new Set());
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const active = images[activeIndex];

  function openGallery(trigger: HTMLButtonElement, index = activeIndex) {
    triggerRef.current = trigger;
    setActiveIndex(index);
    dialogRef.current?.showModal();
  }

  function closeGallery() {
    dialogRef.current?.close();
  }

  function move(direction: -1 | 1) {
    setActiveIndex((current) => (current + direction + images.length) % images.length);
  }

  if (!images.length) {
    return (
      <div className="rental-gallery rental-gallery-empty" role="img" aria-label={`${title} in ${city}`}>
        <Images aria-hidden />
        <span>Photo coming soon</span>
      </div>
    );
  }

  const visibleThumbnails = images.slice(1, 4);
  const remaining = Math.max(0, images.length - 4);

  return (
    <div className={`rental-gallery rental-gallery-count-${Math.min(images.length, 4)}`}>
      <div className="rental-gallery-main-wrap">
        <button
          className="rental-gallery-main"
          type="button"
          aria-label={`Open photo ${activeIndex + 1} of ${images.length}`}
          onClick={(event) => openGallery(event.currentTarget)}
        >
          {active?.url && !broken.has(activeIndex) ? (
            <Image
              src={active.url}
              alt={active.alt || `${title} in ${city}`}
              fill
              loading="eager"
              fetchPriority="high"
              unoptimized={shouldServePublicImageDirectly(active.url)}
              sizes="(max-width: 800px) calc(100vw - 32px), (max-width: 1180px) 68vw, 800px"
              onError={() => setBroken((items) => new Set(items).add(activeIndex))}
            />
          ) : (
            <span className="rental-gallery-fallback"><Images aria-hidden />Photo unavailable</span>
          )}
        </button>
        {images.length > 1 && (
          <>
            <button className="rental-gallery-inline-previous" type="button" aria-label="Previous photo" onClick={() => move(-1)}>
              <ChevronLeft aria-hidden />
            </button>
            <button className="rental-gallery-inline-next" type="button" aria-label="Next photo" onClick={() => move(1)}>
              <ChevronRight aria-hidden />
            </button>
          </>
        )}
        <span className="rental-gallery-count">{activeIndex + 1} / {images.length}</span>
      </div>

      {visibleThumbnails.length > 0 && (
        <div className="rental-gallery-thumbnails" aria-label="Rental photos">
          {visibleThumbnails.map((image, thumbnailIndex) => {
            const index = thumbnailIndex + 1;
            const isLast = thumbnailIndex === visibleThumbnails.length - 1;
            return (
              <button
                className={index === activeIndex ? "active" : ""}
                type="button"
                key={`${image.mediaAssetId}-${image.sortOrder}`}
                aria-label={isLast && remaining > 0 ? `Open all ${images.length} photos` : `View photo ${index + 1} of ${images.length}`}
                aria-current={index === activeIndex ? "true" : undefined}
                onClick={(event) => {
                  if (isLast && remaining > 0) openGallery(event.currentTarget, index);
                  else setActiveIndex(index);
                }}
              >
                {image.url && !broken.has(index) ? (
                  <Image
                    src={image.url}
                    alt=""
                    fill
                    unoptimized={shouldServePublicImageDirectly(image.url)}
                    sizes="(max-width: 800px) 31vw, 320px"
                    onError={() => setBroken((items) => new Set(items).add(index))}
                  />
                ) : <span className="rental-gallery-fallback"><Images aria-hidden /></span>}
                {isLast && remaining > 0 && <span className="rental-gallery-more">+ {remaining} More Photos</span>}
              </button>
            );
          })}
        </div>
      )}

      <dialog
        className="rental-gallery-dialog"
        ref={dialogRef}
        aria-labelledby="rental-gallery-dialog-title"
        onClose={() => triggerRef.current?.focus()}
      >
        <div className="rental-gallery-dialog-inner">
          <h2 className="sr-only" id="rental-gallery-dialog-title">{title} photos</h2>
          <button className="rental-gallery-close" type="button" aria-label="Close photo gallery" onClick={closeGallery}>
            <X aria-hidden />
          </button>
          {images.length > 1 && (
            <button className="rental-gallery-previous" type="button" aria-label="Previous photo" onClick={() => move(-1)}>
              <ChevronLeft aria-hidden />
            </button>
          )}
          <div className="rental-gallery-dialog-image">
            {active?.url && !broken.has(activeIndex) ? (
              <Image
                src={active.url}
                alt={active.alt || `${title} in ${city}`}
                fill
                unoptimized={shouldServePublicImageDirectly(active.url)}
                sizes="95vw"
              />
            ) : <span className="rental-gallery-fallback"><Images aria-hidden />Photo unavailable</span>}
          </div>
          {images.length > 1 && (
            <button className="rental-gallery-next" type="button" aria-label="Next photo" onClick={() => move(1)}>
              <ChevronRight aria-hidden />
            </button>
          )}
          <p aria-live="polite">{activeIndex + 1} of {images.length}</p>
        </div>
      </dialog>
    </div>
  );
}
