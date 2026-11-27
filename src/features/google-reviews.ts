export interface GooglePlaceReview {
  id: string;
  authorName: string;
  authorUri?: string;
  rating: number;
  text: string;
  relativeTime: string;
  publishTime?: string;
}

export interface GoogleReviewFeed {
  reviews: GooglePlaceReview[];
  rating: number | null;
  reviewCount: number;
}

interface PlacesReviewResponse {
  rating?: number;
  userRatingCount?: number;
  reviews?: Array<{
    name?: string;
    rating?: number;
    relativePublishTimeDescription?: string;
    publishTime?: string;
    text?: { text?: string };
    originalText?: { text?: string };
    authorAttribution?: {
      displayName?: string;
      uri?: string;
    };
  }>;
}

export const googleReviewEmptyFeed: GoogleReviewFeed = {
  reviews: [],
  rating: null,
  reviewCount: 0
};

// The homepage hides the review section when the feed is empty, so every reason
// for an empty feed is logged; otherwise a Google-side outage is invisible.
function logReviewFeedUnavailable(reason: string, details: Record<string, unknown> = {}) {
  console.warn(JSON.stringify({ level: "warn", message: "Google reviews unavailable", reason, ...details }));
}

async function readPlacesError(response: Response) {
  try {
    const body = await response.json() as { error?: { status?: unknown; message?: unknown } };
    return {
      googleStatus: typeof body.error?.status === "string" ? body.error.status : undefined,
      googleMessage: typeof body.error?.message === "string" ? body.error.message.slice(0, 300) : undefined
    };
  } catch {
    return {};
  }
}

// Place Details with reviews is a billed Places SKU. Fetching at most once a day
// (about 30 requests a month) keeps usage inside Google's monthly free allowance.
export const GOOGLE_REVIEW_REVALIDATE_SECONDS = 24 * 60 * 60;

export async function loadGoogleReviewFeed(): Promise<GoogleReviewFeed> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY?.trim();
  const placeId = process.env.GOOGLE_PLACES_PLACE_ID?.trim();

  if (!apiKey || !placeId) {
    if (process.env.NODE_ENV === "production") logReviewFeedUnavailable("missing_configuration");
    return googleReviewEmptyFeed;
  }

  try {
    const response = await fetch(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?languageCode=en`,
      {
        headers: {
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": "rating,userRatingCount,reviews"
        },
        next: { revalidate: GOOGLE_REVIEW_REVALIDATE_SECONDS }
      }
    );

    if (!response.ok) {
      logReviewFeedUnavailable("places_request_failed", { httpStatus: response.status, ...await readPlacesError(response) });
      return googleReviewEmptyFeed;
    }

    const data = await response.json() as PlacesReviewResponse;
    const reviews = (data.reviews ?? []).flatMap((review, index) => {
      const reviewText = review.originalText?.text?.trim() || review.text?.text?.trim();
      if (!reviewText) return [];

      return [{
        id: review.name ?? review.publishTime ?? `google-review-${index}`,
        authorName: review.authorAttribution?.displayName?.trim() || "Google reviewer",
        authorUri: review.authorAttribution?.uri,
        rating: typeof review.rating === "number" ? review.rating : 5,
        text: reviewText,
        relativeTime: review.relativePublishTimeDescription?.trim() || "Google review",
        publishTime: review.publishTime
      } satisfies GooglePlaceReview];
    });

    if (!reviews.length) {
      logReviewFeedUnavailable("no_reviews_with_text", { returnedReviews: data.reviews?.length ?? 0 });
      return googleReviewEmptyFeed;
    }

    return {
      reviews,
      rating: typeof data.rating === "number" ? data.rating : null,
      reviewCount: typeof data.userRatingCount === "number" ? data.userRatingCount : reviews.length
    };
  } catch (error) {
    logReviewFeedUnavailable("places_request_error", { error: String(error).slice(0, 300) });
    return googleReviewEmptyFeed;
  }
}
