import { describe, expect, it } from "vitest";
import {
  APPLICATION_EMAIL_MAX_RAW_ATTACHMENT_BYTES,
  applicationEmailAttachmentFilename,
  groupApplicationFilesForEmail,
  renderApplicationSubmittedNotification,
  type ApplicationSubmissionNotificationData
} from "@/features/applications/notification";
import { applicationDraftSchema } from "@/features/applications/schemas";
import type { ApplicationFileRecord, ClientApplicationRecord } from "@/features/applications/contracts";

function file(id: string, byteSize: number): ApplicationFileRecord {
  return {
    id,
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
      file("one", tenMb), file("two", tenMb), file("three", tenMb)
    ]);

    expect(APPLICATION_EMAIL_MAX_RAW_ATTACHMENT_BYTES).toBe(25 * 1024 * 1024);
    expect(groups.map((group) => group.map((item) => item.id))).toEqual([
      ["one", "two"], ["three"]
    ]);
  });

  it("keeps exact-boundary files together and returns one empty group when no files exist", () => {
    const half = APPLICATION_EMAIL_MAX_RAW_ATTACHMENT_BYTES / 2;
    expect(groupApplicationFilesForEmail([file("one", half), file("two", half)]))
      .toHaveLength(1);
    expect(groupApplicationFilesForEmail([])).toEqual([[]]);
  });

  it("creates safe, bounded attachment filenames from user-controlled names", () => {
    const attachment = { ...file("unsafe", 100), originalFilename: "résumé/../../<income>.pdf" };
    const name = applicationEmailAttachmentFilename(attachment, {
      id: "user-1", role: "primary", email: "person@example.test", legalName: "李 / Applicant",
      status: "signed", signedAt: null, draft: applicationDraftSchema.parse({}), files: []
    }, 0);

    expect(name.length).toBeLessThanOrEqual(220);
    expect(name).not.toMatch(/[<>/]/);
    expect(name).toContain("income_.pdf");
  });

  it("renders all application details with escaped HTML", () => {
    const draft = applicationDraftSchema.parse({
      personal: { legalFirstName: "Primary", legalLastName: "Applicant", phone: "6045550100", email: "primary@example.test" },
      tenancy: { desiredMoveInDate: "2026-09-01", leaseTerm: "one_year", occupantCount: 2, needsShowing: "no", reasonForChoosing: "Close to work" },
      housing: { currentAddress: "1 Main St", currentHousingSince: "2024-01", landlordName: "Landlord", landlordPhone: "6045550101", reasonForLeaving: "Moving" },
      employment: { employmentStatus: "employed", employerOrIncomeSource: "Primary & Partners <Ltd>", occupation: "Manager", employmentSince: "2020-01", grossMonthlyIncome: 8000, contactName: "Boss", contactPhone: "6045550102" },
      references: { primary: { name: "Ref", relationship: "Manager", phone: "6045550103" } },
      emergency: { name: "Emergency", relationship: "Sibling", phone: "6045550104" }
    });
    const application = {
      id: "application-1", ownerUserId: "user-1", propertyTitle: "Test Home",
      propertyAddress: "123 Test Street", submittedAt: "2026-08-28T18:00:00.000Z",
      consentedAt: "2026-08-28T18:00:00.000Z", retainUntil: "2027-08-28T18:00:00.000Z",
      formVersion: "form-1", termsVersion: "terms-1", files: [], draft
    } as unknown as ClientApplicationRecord;
    const data: ApplicationSubmissionNotificationData = {
      application,
      applicants: [{
        id: "user-1", role: "primary", legalName: "Primary Applicant",
        email: "primary@example.test", status: "signed", signedAt: application.submittedAt,
        draft, files: []
      }]
    };

    const message = renderApplicationSubmittedNotification({
      data, appBaseUrl: "https://silverkey.ca", attachedFiles: [], partIndex: 1, partCount: 1
    });

    expect(message.text).toContain("PRIMARY APPLICANT");
    expect(message.text).toContain("Gross monthly income: $8,000");
    expect(message.text).toContain("Primary & Partners <Ltd>");
    expect(message.html).toContain("Primary &amp; Partners &lt;Ltd&gt;");
    expect(message.html).toContain("Review in Admin");
    expect(message.html).not.toContain("Primary & Partners <Ltd>");
  });

  it("renders optional tenancy/reference branches and multipart labels", () => {
    const draft = applicationDraftSchema.parse({
      personal: { legalFirstName: "Pet", legalLastName: "Owner", email: "pet@example.test" },
      tenancy: { hasPets: true, petDetails: "One cat", needsParking: true },
      references: { secondary: { name: "Second Ref", relationship: "Friend", phone: "6045550111" } }
    });
    const attachment = file("supporting", 2048);
    const application = {
      id: "application-2", ownerUserId: "user-2", propertyTitle: "Test Home",
      propertyAddress: "123 Test Street", status: "submitted", assignedAt: "invalid",
      submittedAt: "invalid", consentedAt: null, retainUntil: null, draftUpdatedAt: null,
      formVersion: "form-1", formSha256: "form-sha", termsVersion: "terms-1",
      termsSha256: "terms-sha", files: [attachment], draft
    } as unknown as ClientApplicationRecord;
    const message = renderApplicationSubmittedNotification({
      data: { application, applicants: [{
        id: "user-2", role: "primary", email: "pet@example.test", legalName: "Pet Owner",
        status: "signed", signedAt: null, draft, files: [attachment]
      }] },
      appBaseUrl: "https://silverkey.ca", attachedFiles: [attachment], partIndex: 2, partCount: 3
    });

    expect(message.subject).toContain("attachments 2/3");
    expect(message.text).toContain("Pets: One cat");
    expect(message.text).toContain("Parking: Required");
    expect(message.text).toContain("Second Ref");
    expect(message.html).toContain("Part 2 of 3");
    expect(message.html).toContain("Manual Review Required");
    expect(message.html).toContain("Form SHA-256");
  });
});
