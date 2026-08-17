"use client";

import { useState } from "react";
import { ArrowLeft, ArrowRight, ExternalLink, Quote, Star } from "lucide-react";
import type { GooglePlaceReview } from "@/features/google-reviews";

interface GoogleReviewCardProps {
  businessUrl: string;
  reviewUrl: string;
  reviews: GooglePlaceReview[];
  rating: number | null;
  reviewCount: number;
}

function reviewerInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "G";
}

function StarRow({ rating, label }: { rating: number; label: string }) {
  return (
    <span className="google-review-stars" role="img" aria-label={label}>
      {[1, 2, 3, 4, 5].map((value) => (
        <Star key={value} className={value <= Math.round(rating) ? "is-filled" : undefined} aria-hidden />
      ))}
    </span>
  );
}

export function GoogleReviewCard({
  businessUrl,
  reviewUrl,
  reviews,
  rating,
  reviewCount
}: GoogleReviewCardProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const activeReview = reviews[activeIndex] ?? reviews[0];
  const canMove = reviews.length > 1;

  const move = (direction: number) => {
    if (!canMove) return;
    setActiveIndex((current) => (current + direction + reviews.length) % reviews.length);
  };

  if (!activeReview) return null;
  const displayedRating = rating ?? activeReview.rating;
  const displayedReviewCount = Math.max(reviewCount, reviews.length);

  return (
    <aside
      className="google-review-card"
      aria-labelledby="google-review-heading"
      aria-roledescription="carousel"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") move(-1);
        if (event.key === "ArrowRight") move(1);
      }}
    >
      <div className="google-review-topline">
        <div className="google-review-brand">
          <span className="google-gmark" aria-hidden>G</span>
          <span>
            <small>CLIENT STORIES</small>
            <strong id="google-review-heading">Google Reviews</strong>
          </span>
        </div>
      </div>

      <div className="google-review-score">
        <strong>{displayedRating.toFixed(1)}</strong>
        <span>
          <StarRow rating={displayedRating} label={`${displayedRating} out of 5 stars`} />
          <small>{displayedReviewCount} Google review{displayedReviewCount === 1 ? "" : "s"}</small>
        </span>
      </div>

      <article className="google-review-slide" key={activeReview.id} aria-live="polite">
        <div className="google-review-author">
          <span className="google-review-avatar" aria-hidden>{reviewerInitials(activeReview.authorName)}</span>
          <span>
            {activeReview.authorUri ? (
              <a href={activeReview.authorUri} target="_blank" rel="noreferrer">{activeReview.authorName}</a>
            ) : (
              <strong>{activeReview.authorName}</strong>
            )}
            <small>{activeReview.relativeTime}</small>
          </span>
          <StarRow rating={activeReview.rating} label={`${activeReview.rating} out of 5 stars`} />
        </div>
        <blockquote>
          <Quote aria-hidden />
          <p>{activeReview.text}</p>
        </blockquote>
      </article>

      <div className="google-review-footer">
        <div className="google-review-navigation" aria-label="Review navigation">
          <button type="button" onClick={() => move(-1)} disabled={!canMove} aria-label="Previous review">
            <ArrowLeft aria-hidden />
          </button>
          <span>{String(activeIndex + 1).padStart(2, "0")} / {String(reviews.length).padStart(2, "0")}</span>
          <button type="button" onClick={() => move(1)} disabled={!canMove} aria-label="Next review">
            <ArrowRight aria-hidden />
          </button>
        </div>
        <a className="google-review-business-link" href={businessUrl} target="_blank" rel="noreferrer">
          View on Google <ExternalLink aria-hidden />
        </a>
      </div>

      <a className="google-review-submit" href={reviewUrl} target="_blank" rel="noreferrer">
        Share your experience
        <ExternalLink aria-hidden />
      </a>

    </aside>
  );
}
