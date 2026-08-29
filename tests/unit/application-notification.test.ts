import { describe, expect, it } from "vitest";
import {
  APPLICATION_EMAIL_MAX_RAW_ATTACHMENT_BYTES,
  groupApplicationFilesForEmail,
  renderApplicationSubmittedNotification,
  type ApplicationSubmissionNotificationData
} from "@/features/applications/notification";
import { applicationDraftSchema } from "@/features/applications/schemas";
import type { ApplicationFileRecord, ClientApplicationRecord } from "@/features/applications/contracts";

function file(id: string, byteSize: number): ApplicationFileRecord {
  return {
    id,
    applicantId: "primary",
    documentType: "other",
    originalFilename: `${id}.pdf`,
    mimeType: "application/pdf",
    byteSize,
    scanStatus: "manual_review_required",
    uploadedAt: "2026-08-28T18:00:00.000Z"
  };
}

describe("application submission email", () => {
  it("splits raw attachments below the conservative Resend email budget", () => {
    const tenMb = 10 * 1024 * 1024;
    const groups = groupApplicationFilesForEmail([
      file("one", tenMb),
      file("two", tenMb),
      file("three", tenMb)
    ]);

    expect(APPLICATION_EMAIL_MAX_RAW_ATTACHMENT_BYTES).toBe(25 * 1024 * 1024);
    expect(groups.map((group) => group.map((item) => item.id))).toEqual([
      ["one", "two"],
      ["three"]
    ]);
  });

  it("renders every applicant section and escapes submitted values", () => {
    const primaryDraft = applicationDraftSchema.parse({
      personal: { legalFirstName: "Primary", legalLastName: "Applicant", phone: "6045550100", email: "primary@example.test" },
      tenancy: { desiredMoveInDate: "2026-09-01", leaseTerm: "one_year", adultCount: 2, childCount: 0, needsShowing: "no" },
      housing: { currentAddress: "1 Main St", currentHousingSince: "2024-01", landlordName: "Landlord", landlordPhone: "6045550101", reasonForLeaving: "Moving" },
      employment: { employmentStatus: "employed", employerOrIncomeSource: "Primary Co", occupation: "Manager", employmentSince: "2020-01", grossMonthlyIncome: 8000, contactName: "Boss", contactPhone: "6045550102" },
      references: { primary: { name: "Ref", relationship: "Manager", phone: "6045550103" } },
      emergency: { name: "Emergency", relationship: "Sibling", phone: "6045550104" }
    });
    const coDraft = applicationDraftSchema.parse({
      ...primaryDraft,
      personal: { ...primaryDraft.personal, legalFirstName: "Co", legalLastName: "Applicant", email: "co@example.test" },
      employment: { ...primaryDraft.employment, employerOrIncomeSource: "Co & Partners <Ltd>" }
    });
    const application = {
      id: "application-1",
      propertyTitle: "Test Home",
      propertyAddress: "123 Test Street",
      submittedAt: "2026-08-28T18:00:00.000Z",
      consentedAt: "2026-08-28T18:00:00.000Z",
      retainUntil: "2027-08-28T18:00:00.000Z",
      formVersion: "form-1",
      termsVersion: "terms-1",
      files: []
    } as unknown as ClientApplicationRecord;
    const data: ApplicationSubmissionNotificationData = {
      application,
      applicants: [
        { id: "primary", role: "primary", legalName: "Primary Applicant", email: "primary@example.test", status: "signed", invitationExpiresAt: null, draftUpdatedAt: null, signedAt: application.submittedAt, draft: primaryDraft, files: [] },
        { id: "co", role: "co_applicant", legalName: "Co Applicant", email: "co@example.test", status: "signed", invitationExpiresAt: null, draftUpdatedAt: null, signedAt: application.submittedAt, draft: coDraft, files: [] }
      ]
    };

    const message = renderApplicationSubmittedNotification({
      data,
      appBaseUrl: "https://silverkey.ca",
      attachedFiles: [],
      partIndex: 1,
      partCount: 1
    });

    expect(message.text).toContain("PRIMARY APPLICANT");
    expect(message.text).toContain("CO-APPLICANT 1");
    expect(message.text).toContain("Co & Partners <Ltd>");
    expect(message.html).toContain("Co &amp; Partners &lt;Ltd&gt;");
    expect(message.html).not.toContain("Co & Partners <Ltd>");
  });
});
