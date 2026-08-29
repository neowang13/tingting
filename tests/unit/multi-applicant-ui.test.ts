import { describe, expect, it } from "vitest";
import { activeCoApplicantsSigned, type CoApplicantSummary } from "@/components/client/co-applicant-panel";

function applicant(id: string, status: CoApplicantSummary["status"]): CoApplicantSummary {
  return {
    id,
    legalName: `Applicant ${id}`,
    email: `${id}@example.test`,
    status,
    signedAt: status === "signed" ? "2026-08-26T18:00:00.000Z" : null
  };
}

describe("multi-applicant submission readiness", () => {
  it("allows a single-applicant application to continue", () => {
    expect(activeCoApplicantsSigned([])).toBe(true);
  });

  it("blocks submission while any active co-applicant has not signed", () => {
    expect(activeCoApplicantsSigned([
      applicant("signed", "signed"),
      applicant("waiting", "in_progress")
    ])).toBe(false);
  });

  it("excludes revoked applicants from the signing requirement", () => {
    expect(activeCoApplicantsSigned([
      applicant("signed", "signed"),
      applicant("removed", "revoked")
    ])).toBe(true);
  });
});
