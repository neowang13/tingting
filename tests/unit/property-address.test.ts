import { describe, expect, it } from "vitest";
import { formatPropertyAddress, normalizePropertyAddressLine } from "@/lib/property-address";

describe("optional rental street address", () => {
  it("uses the city without an empty prefix when street address is absent", () => {
    expect(formatPropertyAddress("", "Vancouver")).toBe("Vancouver");
    expect(formatPropertyAddress("   ", "Richmond")).toBe("Richmond");
    expect(formatPropertyAddress("Unit 101, ", "Vancouver")).toBe("Unit 101, Vancouver");
    expect(normalizePropertyAddressLine("Unit 101, ")).toBe("Unit 101");
  });

  it("preserves a provided street address", () => {
    expect(formatPropertyAddress("1 Test Street", "Vancouver")).toBe("1 Test Street, Vancouver");
  });
});
