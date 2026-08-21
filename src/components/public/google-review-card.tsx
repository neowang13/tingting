import { ExternalLink, Star } from "lucide-react";
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

function GoogleWordmark() {
  return (
    <span className="google-wordmark" aria-label="Google">
      <span>G</span><span>o</span><span>o</span><span>g</span><span>l</span><span>e</span>
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
  if (!reviews.length) return null;

  const displayedRating = rating ?? reviews[0].rating;
  const displayedReviewCount = reviewCount || reviews.length;

  return (
    <section className="section google-reviews-section" aria-labelledby="google-review-heading">
      <div className="container google-reviews-panel">
        <div className="google-reviews-summary">
          <div className="google-review-brand">
            <GoogleWordmark />
            <h2 id="google-review-heading">Reviews</h2>
          </div>

          <div className="google-review-score">
            <strong>{displayedRating.toFixed(1)}</strong>
            <span>
              <StarRow rating={displayedRating} label={`${displayedRating} out of 5 stars`} />
              <small>{displayedReviewCount} Google review{displayedReviewCount === 1 ? "" : "s"}</small>
            </span>
          </div>

          <a className="google-review-submit" href={reviewUrl} target="_blank" rel="noreferrer">
            Write a review
            <ExternalLink aria-hidden />
          </a>
          <p className="google-review-disclosure">Ratings and reviews are published on Google and shown here as written.</p>
        </div>

        <div className="google-reviews-feed">
          <div className="google-reviews-feed-header">
            <strong>Customer reviews</strong>
            <a className="google-review-business-link" href={businessUrl} target="_blank" rel="noreferrer">
              Read all Google reviews <ExternalLink aria-hidden />
            </a>
          </div>

          <div className={`google-reviews-grid${reviews.length === 1 ? " is-single" : ""}`}>
            {reviews.map((review) => (
              <article className="google-review-item" key={review.id}>
                <div className="google-review-author">
                  <span className="google-review-avatar" aria-hidden>{reviewerInitials(review.authorName)}</span>
                  <span>
                    {review.authorUri ? (
                      <a href={review.authorUri} target="_blank" rel="noreferrer">{review.authorName}</a>
                    ) : (
                      <strong>{review.authorName}</strong>
                    )}
                  </span>
                </div>
                <div className="google-review-meta">
                  <StarRow rating={review.rating} label={`${review.rating} out of 5 stars`} />
                  <time dateTime={review.publishTime}>{review.relativeTime}</time>
                </div>
                <p>{review.text}</p>
              </article>
            ))}
          </div>

          <a className="google-review-mobile-link" href={businessUrl} target="_blank" rel="noreferrer">
            Read all Google reviews
            <ExternalLink aria-hidden />
          </a>
        </div>
      </div>
    </section>
  );
}
