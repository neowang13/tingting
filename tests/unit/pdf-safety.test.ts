import { describe, expect, it } from "vitest";
import { hasUnsafePdfFeatures } from "@/lib/pdf-safety";

const pdf = (body: string) => Buffer.from(`%PDF-1.3\n${body}\n%%EOF`, "latin1");

describe("PDF upload preflight", () => {
  it.each([
    "/OpenAction [3 0 R /FitH null]",
    "/OpenAction [3 0 R /Fit]",
    "/OpenAction [3 0 R /FitB]",
    "/OpenAction [3 0 R /FitV 0]",
    "/OpenAction [3 0 R /FitBH 42]",
    "/OpenAction [3 0 R /FitBV -2.5]",
    "/OpenAction [3 0 R /XYZ null 0 1.25]",
    "/OpenAction [3 0 R /FitR 0 0 100 200]",
    "/Open#41ction [3 0 R /FitH null]"
  ])("accepts a non-executable initial page view: %s", (view) => {
    expect(hasUnsafePdfFeatures(pdf(`<< /Type /Catalog ${view} >>`))).toBe(false);
  });

  it.each([
    "/OpenAction << /S /JavaScript /JS (run) >>",
    "/OpenAction 9 0 R",
    "/OpenAction /NamedDestination",
    "/OpenAction [3 0 R /FitH null /JavaScript]",
    "/OpenAction [3 0 R /FitH null] /OpenAction 9 0 R",
    "/OpenAction [3 0 R /XYZ null 0]",
    "/Launch", "/EmbeddedFile", "/EmbeddedFiles", "/JS", "/JavaScript",
    "/Java#53cript", "/J#53", "/Laun#63h", "/Embedded#46ile"
  ])("rejects executable, embedded or unresolved features: %s", (feature) => {
    expect(hasUnsafePdfFeatures(pdf(feature))).toBe(true);
  });

  it("still rejects active features alongside a valid initial page view", () => {
    expect(hasUnsafePdfFeatures(pdf("/OpenAction [3 0 R /FitH null] /Names << /JavaScript 9 0 R >>"))).toBe(true);
  });
});
