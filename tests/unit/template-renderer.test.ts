import { describe, expect, it } from "vitest";
import {
  estimateSmsSegments,
  renderTemplate,
  sampleTemplateContext,
  validateTemplateVariables
} from "../../src/features/notifications/template-renderer";

describe("notification template rendering", () => {
  it("renders only approved variables", () => {
    expect(renderTemplate("Hi {{tenant_name}}, rent is due {{due_date}}.", sampleTemplateContext))
      .toBe("Hi Alex Chen, rent is due August 1, 2026.");
  });

  it("rejects unknown and missing variables", () => {
    expect(() => validateTemplateVariables("{{rent_amount}}")).toThrow("Unknown template variable");
    expect(() => renderTemplate("Hi {{tenant_name}}", {})).toThrow("A value for {{tenant_name}} is required");
  });

  it("estimates GSM-style and Unicode SMS segments", () => {
    expect(estimateSmsSegments("a".repeat(160))).toBe(1);
    expect(estimateSmsSegments("a".repeat(161))).toBe(2);
    expect(estimateSmsSegments("租".repeat(71))).toBe(2);
  });
});
