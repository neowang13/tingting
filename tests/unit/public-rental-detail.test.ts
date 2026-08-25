import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { createElement } from "react";
import { renderToPipeableStream } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RentalDetailPage } from "@/components/public/rental-detail-page";
import { demoRentals, demoSections } from "@/data/demo";
import {
  formatRentalArea,
  formatRentalAvailability,
  formatRentalCount,
  formatRentalLocation,
  formatRentalPrice,
  getPublicRentalVideo,
  type PublicRentalDetailData
} from "@/features/content/public-rental-detail";
import { sectionSchemas } from "@/features/content/schemas";

describe("public rental detail formatters", () => {
  it("formats public listing values consistently", () => {
    expect(formatRentalPrice(245_000)).toBe("$2,450");
    expect(formatRentalCount(0)).toBe("0");
    expect(formatRentalCount(1.5)).toBe("1.5");
    expect(formatRentalArea(620)).toBe("620 sq. ft.");
    expect(formatRentalLocation(null, "Vancouver")).toBe("Vancouver");
    expect(formatRentalLocation("Downtown", "Vancouver")).toBe("Downtown, Vancouver");
  });

  it("uses Vancouver calendar semantics for availability", () => {
    expect(formatRentalAvailability(
      "2026-07-27",
      new Date("2026-07-28T06:30:00Z")
    )).toBe("Available now");
    expect(formatRentalAvailability(
      "2026-08-01",
      new Date("2026-07-27T20:00:00Z")
    )).toBe("Aug 1, 2026");
  });

  it("exposes the imported video tour only for the matching rental", () => {
    expect(getPublicRentalVideo("sail-5981-gray-avenue")).toEqual({
      url: "/listings/facebook/1044446938097580/tour.mp4",
      posterUrl: "/listings/facebook/1044446938097580/tour-poster.jpg",
      title: "Video tour of the home"
    });
    expect(getPublicRentalVideo("another-rental")).toBeNull();
  });

  it("keeps the mapped video and poster files in the public build", async () => {
    const video = getPublicRentalVideo("sail-5981-gray-avenue");
    const videoPath = path.join(process.cwd(), "public", video!.url);
    const posterPath = path.join(process.cwd(), "public", video!.posterUrl);
    const [videoFile, posterFile, posterBytes] = await Promise.all([
      stat(videoPath),
      stat(posterPath),
      readFile(posterPath)
    ]);

    expect(videoFile.isFile()).toBe(true);
    expect(videoFile.size).toBeGreaterThan(1_000_000);
    expect(posterFile.isFile()).toBe(true);
    expect(posterFile.size).toBeGreaterThan(10_000);
    expect(posterBytes.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  });

  it("renders the mapped tour with controls, source, poster, and fallback link", async () => {
    const videoTour = getPublicRentalVideo("sail-5981-gray-avenue");
    const sections = Object.fromEntries(
      (["header", "contact", "footer"] as const).map((key) => [
        key,
        sectionSchemas[key].parse(
          demoSections.find((section) => section.key === key)?.publishedContent
        )
      ])
    ) as PublicRentalDetailData["sections"];
    const markup = await renderMarkup(createElement(RentalDetailPage, {
      rental: structuredClone(demoRentals[0]),
      videoTour,
      similarRentals: [],
      sections
    }));

    expect(markup).toContain("<video");
    expect(markup).toContain("controls=\"\"");
    expect(markup).toContain(`poster=\"${videoTour!.posterUrl}\"`);
    expect(markup).toContain(`src=\"${videoTour!.url}\"`);
    expect(markup).toContain(`href=\"${videoTour!.url}\"`);
  });
});

function renderMarkup(element: React.ReactNode): Promise<string> {
  return new Promise((resolve, reject) => {
    const output: Buffer[] = [];
    const destination = new PassThrough();
    destination.on("data", (chunk: Buffer) => output.push(chunk));
    destination.on("end", () => resolve(Buffer.concat(output).toString("utf8")));
    destination.on("error", reject);

    const stream = renderToPipeableStream(element, {
      onAllReady() {
        stream.pipe(destination);
      },
      onError: reject
    });
  });
}
