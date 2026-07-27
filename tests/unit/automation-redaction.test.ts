import { describe, expect, it } from "vitest";
import { redactText, redactValue } from "@/features/automation/redaction";

describe("automation redaction", () => {
  it("removes tenant destinations, tokens, signed URLs, and sensitive fields", () => {
    const token = `tta_abcdefgh_${"x".repeat(43)}`;
    const output = JSON.stringify(redactValue({
      message: `Bearer ${token} tenant@example.com +16045550123 https://example.com/a?token=secret`,
      internalNotes: "private"
    }));
    expect(output).not.toContain(token);
    expect(output).not.toContain("tenant@example.com");
    expect(output).not.toContain("+16045550123");
    expect(output).not.toContain("private");
    expect(redactText("safe operational text")).toBe("safe operational text");
    expect(redactText("85304493-473a-4b14-b814-530432daf135"))
      .toBe("85304493-473a-4b14-b814-530432daf135");
  });
});
