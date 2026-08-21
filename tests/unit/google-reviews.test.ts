import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { googleReviewEmptyFeed, loadGoogleReviewFeed } from "../../src/features/google-reviews";

describe("Google review feed", () => {
  const originalApiKey = process.env.GOOGLE_PLACES_API_KEY;
  const originalPlaceId = process.env.GOOGLE_PLACES_PLACE_ID;

  beforeEach(() => {
    process.env.GOOGLE_PLACES_API_KEY = "test-key";
    process.env.GOOGLE_PLACES_PLACE_ID = "test-place";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalApiKey === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
    else process.env.GOOGLE_PLACES_API_KEY = originalApiKey;
    if (originalPlaceId === undefined) delete process.env.GOOGLE_PLACES_PLACE_ID;
    else process.env.GOOGLE_PLACES_PLACE_ID = originalPlaceId;
  });

  it("returns only reviews supplied by Places and preserves original review text", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        rating: 5,
        userRatingCount: 1,
        reviews: [{
          name: "places/test/reviews/one",
          rating: 5,
          relativePublishTimeDescription: "in the last week",
          publishTime: "2026-08-20T01:00:00Z",
          text: { text: "Translated text" },
          originalText: { text: "Original text" },
          authorAttribution: { displayName: "Xiaochen Wang", uri: "https://example.test/reviewer" }
        }]
      })
    }));

    await expect(loadGoogleReviewFeed()).resolves.toEqual({
      rating: 5,
      reviewCount: 1,
      reviews: [{
        id: "places/test/reviews/one",
        authorName: "Xiaochen Wang",
        authorUri: "https://example.test/reviewer",
        rating: 5,
        text: "Original text",
        relativeTime: "in the last week",
        publishTime: "2026-08-20T01:00:00Z"
      }]
    });
  });

  it("shows no placeholder review when Places fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));

    await expect(loadGoogleReviewFeed()).resolves.toEqual(googleReviewEmptyFeed);
  });
});
