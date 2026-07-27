import { describe, expect, it } from "vitest";
import {
  isSeededPublicMedia,
  resolveSeededPublicMedia
} from "../../src/features/content/public-media";

describe("seeded public media", () => {
  it("distinguishes known seeded placeholders from missing media", () => {
    expect(isSeededPublicMedia("10000000-0000-4000-8000-000000000001")).toBe(true);
    expect(isSeededPublicMedia("10000000-0000-4000-8000-000000000002")).toBe(true);
    expect(isSeededPublicMedia("11000000-0000-4000-8000-000000000014")).toBe(true);
    expect(isSeededPublicMedia("30000000-0000-4000-8000-000000000001")).toBe(false);
  });

  it("resolves the seeded hero image", () => {
    expect(resolveSeededPublicMedia("10000000-0000-4000-8000-000000000001"))
      .toMatch(/^https:\/\//);
  });

  it("resolves seeded service-page media", () => {
    expect(resolveSeededPublicMedia("11000000-0000-4000-8000-000000000010"))
      .toMatch(/^https:\/\//);
  });
});
