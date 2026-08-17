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
  isDemo: boolean;
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

const demoReview: GooglePlaceReview = {
  id: "demo-humidity-review",
  authorName: "Xiaochen W.",
  rating: 5,
  relativeTime: "Just now",
  text: "We had a serious humidity problem in our apartment, and some of our clothes were even starting to develop mould. Ting Ting patiently helped us investigate the possible causes and worked through the issues until everything was resolved. She was thorough, responsive, and extremely responsible throughout the entire process. 10/10—highly recommended!"
};

export const googleReviewDemoFeed: GoogleReviewFeed = {
  reviews: [demoReview],
  rating: null,
  reviewCount: 0,
  isDemo: true
};

export async function loadGoogleReviewFeed(): Promise<GoogleReviewFeed> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY?.trim();
  const placeId = process.env.GOOGLE_PLACES_PLACE_ID?.trim();

  if (!apiKey || !placeId) return googleReviewDemoFeed;

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

    if (!response.ok) return googleReviewDemoFeed;

    const data = await response.json() as PlacesReviewResponse;
    const reviews = (data.reviews ?? []).flatMap((review, index) => {
      const reviewText = review.text?.text?.trim() || review.originalText?.text?.trim();
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

    if (!reviews.length) return googleReviewDemoFeed;

    return {
      reviews,
      rating: typeof data.rating === "number" ? data.rating : null,
      reviewCount: typeof data.userRatingCount === "number" ? data.userRatingCount : reviews.length,
      isDemo: false
    };
  } catch {
    return googleReviewDemoFeed;
  }
}
