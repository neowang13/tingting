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

export async function loadGoogleReviewFeed(): Promise<GoogleReviewFeed> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY?.trim();
  const placeId = process.env.GOOGLE_PLACES_PLACE_ID?.trim();

  if (!apiKey || !placeId) return googleReviewEmptyFeed;

  try {
    const response = await fetch(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?languageCode=en`,
      {
        headers: {
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": "rating,userRatingCount,reviews"
        },
        next: { revalidate: 300 }
      }
    );

    if (!response.ok) return googleReviewEmptyFeed;

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

    if (!reviews.length) return googleReviewEmptyFeed;

    return {
      reviews,
      rating: typeof data.rating === "number" ? data.rating : null,
      reviewCount: typeof data.userRatingCount === "number" ? data.userRatingCount : reviews.length
    };
  } catch {
    return googleReviewEmptyFeed;
  }
}
