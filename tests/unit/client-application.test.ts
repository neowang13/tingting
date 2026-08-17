import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  APPLICATION_TERMS_VERSION,
  applicationTermsText
} from "@/features/applications/contracts";
import {
  applicationReceipt,
  assertApplicationMaterialsApproved,
  convertApprovedApplicationToTenant,
  getApplicationForm,
  getApplicationFileForStaff,
  getSignedLeaseForStaff,
  getClientApplication,
  listClientApplications,
  resetDemoApplicationsForTests,
  reviewApplicationFile,
  saveApplicationDraft,
  startOrReuseClientApplication,
  submitClientApplication,
  updateApplicationStatus,
  uploadApplicationFile,
  uploadSignedLeaseForStaff
} from "@/features/applications/service";
import type { ClientIdentity } from "@/features/applications/contracts";
import { applicationDraftSchema } from "@/features/applications/schemas";
import type { EmailProvider } from "@/features/notifications/providers/types";

const client: ClientIdentity = {
  userId: "00000000-0000-4000-8000-000000000009",
  email: "client@example.test",
  displayName: "Demo Applicant"
};
const applicationId = "30000000-0000-4000-8000-000000000009";

function pdfFile(content = "%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF") {
  return new File([content], "completed-application.pdf", { type: "application/pdf" });
}

function completeDraft() {
  return applicationDraftSchema.parse({
    personal: { legalFirstName: "Demo", legalLastName: "Applicant", phone: "6045550182", email: "client@example.test" },
    tenancy: { desiredMoveInDate: "2026-09-01", leaseTerm: "one_year", occupantCount: 1, needsShowing: "no", reasonForChoosing: "The location and lease term fit my needs." },
    housing: { currentAddress: "10 Current Street, Vancouver", currentHousingSince: "2024-01", currentMonthlyRent: 2200, landlordName: "Current Landlord", landlordPhone: "6045550111", reasonForLeaving: "Need a different location." },
    employment: { employmentStatus: "employed", employerOrIncomeSource: "Example Company", occupation: "Designer", employmentSince: "2022-06", grossMonthlyIncome: 7200, contactName: "Manager Name", contactPhone: "6045550122" },
    references: { primary: { name: "Reference Person", relationship: "Former manager", phone: "6045550133" } },
    emergency: { name: "Emergency Person", relationship: "Sibling", phone: "6045550144" }
  });
}

async function saveCompleteDraft() {
  await saveApplicationDraft(client, applicationId, { draft: completeDraft(), activeStep: 6 });
}

beforeEach(() => {
  process.env.DATA_BACKEND = "memory";
  resetDemoApplicationsForTests();
});

describe("client application workflow", () => {
  it("uses the finalized approved consent copy", () => {
    expect(APPLICATION_TERMS_VERSION).toBe("2026-08-08.1");
    expect(applicationTermsText).not.toMatch(/draft|pre-production|before production/i);
    expect(applicationTermsText).toContain("info@silverkey.ca");
  });

  it("fails closed for unapproved application materials in durable mode", () => {
    expect(() => assertApplicationMaterialsApproved({ legalReviewStatus: "pending" }, true))
      .toThrow(expect.objectContaining({ status: 409, code: "APPLICATION_LEGAL_REVIEW_REQUIRED" }));
    expect(() => assertApplicationMaterialsApproved({ legalReviewStatus: "approved" }, true))
      .not.toThrow();
  });

  it("starts one owned application per published rental and reuses it", async () => {
    const first = await startOrReuseClientApplication(client, "melville-street-two-bedroom");
    const repeated = await startOrReuseClientApplication(client, "melville-street-two-bedroom");

    expect(first.id).toBe(repeated.id);
    expect(first.ownerUserId).toBe(client.userId);
    expect(first.propertySlug).toBe("melville-street-two-bedroom");
    expect(first.status).toBe("draft");

    const otherClient = { ...client, userId: "00000000-0000-4000-8000-000000000010", email: "other@example.test" };
    const otherApplication = await startOrReuseClientApplication(otherClient, "melville-street-two-bedroom");
    expect(otherApplication.id).not.toBe(first.id);
    await expect(getClientApplication(client, otherApplication.id))
      .rejects.toMatchObject({ status: 404, code: "APPLICATION_NOT_FOUND" });
  });

  it("does not start an application for a missing or unpublished rental", async () => {
    await expect(startOrReuseClientApplication(client, "not-a-public-rental"))
      .rejects.toMatchObject({ status: 404, code: "RENTAL_NOT_FOUND" });
  });

  it("enforces application ownership for reads and form downloads", async () => {
    expect(await listClientApplications(client)).toHaveLength(1);
    await expect(getClientApplication({ ...client, userId: crypto.randomUUID() }, applicationId))
      .rejects.toMatchObject({ status: 404, code: "APPLICATION_NOT_FOUND" });
    const download = await getApplicationForm(client, applicationId);
    expect(download.filename).toContain("2026-07-31.1");
    expect(download.bytes.toString("utf8")).toContain("secure online application");
  });

  it("sniffs content and rejects active PDF content or extension mismatches", async () => {
    await expect(uploadApplicationFile(client, applicationId, pdfFile("%PDF-1.7\n/OpenAction /JavaScript")))
      .rejects.toMatchObject({ code: "UNSAFE_APPLICATION_FILE" });
    await expect(uploadApplicationFile(
      client,
      applicationId,
      new File([Buffer.from([0xff, 0xd8, 0xff, 0x00])], "fake.png", { type: "image/png" })
    )).rejects.toMatchObject({ code: "APPLICATION_FILE_TYPE_MISMATCH" });
  });

  it("saves an owned structured draft and rejects incomplete online applications", async () => {
    const draft = applicationDraftSchema.parse({ personal: { legalFirstName: "Draft" } });
    const saved = await saveApplicationDraft(client, applicationId, { draft, activeStep: 1 });
    expect(saved.draft.personal.legalFirstName).toBe("Draft");
    await uploadApplicationFile(client, applicationId, pdfFile());
    const application = await getClientApplication(client, applicationId);
    await expect(submitClientApplication(client, applicationId, {
      sharingAuthorization: true,
      screeningConsent: true,
      termsVersion: application.termsVersion,
      termsSha256: application.termsSha256,
      formVersion: application.formVersion,
      formSha256: application.formSha256
    }, { requestId: "test", userAgentHash: "hash" })).rejects.toMatchObject({ code: "APPLICATION_DRAFT_INCOMPLETE" });
  });

  it("requires a file, both unchecked-by-default authorizations, and exact versions", async () => {
    await saveCompleteDraft();
    const application = await getClientApplication(client, applicationId);
    const base = {
      sharingAuthorization: true,
      screeningConsent: true,
      termsVersion: application.termsVersion,
      termsSha256: application.termsSha256,
      formVersion: application.formVersion,
      formSha256: application.formSha256
    };
    await expect(submitClientApplication(client, applicationId, base, { requestId: "test", userAgentHash: "hash" }))
      .rejects.toMatchObject({ code: "APPLICATION_FILE_REQUIRED" });
    await uploadApplicationFile(client, applicationId, pdfFile());
    await expect(submitClientApplication(client, applicationId, { ...base, screeningConsent: false }, { requestId: "test", userAgentHash: "hash" }))
      .rejects.toMatchObject({ code: "APPLICATION_CONSENT_REQUIRED" });
    await expect(submitClientApplication(client, applicationId, { ...base, termsVersion: "stale" }, { requestId: "test", userAgentHash: "hash" }))
      .rejects.toMatchObject({ code: "APPLICATION_VERSION_CHANGED" });
  });

  it("records immutable consent evidence, retention, status, and a downloadable receipt", async () => {
    await saveCompleteDraft();
    await uploadApplicationFile(client, applicationId, pdfFile());
    const application = await getClientApplication(client, applicationId);
    const send = vi.fn<EmailProvider["send"]>().mockResolvedValue({
      providerMessageId: "resend-application-test",
      status: "queued"
    });
    const submitted = await submitClientApplication(client, applicationId, {
      sharingAuthorization: true,
      screeningConsent: true,
      termsVersion: application.termsVersion,
      termsSha256: application.termsSha256,
      formVersion: application.formVersion,
      formSha256: application.formSha256
    }, { requestId: "test-request", userAgentHash: "test-agent-hash" }, {
      notifier: { send },
      recipient: "admin@example.test",
      appBaseUrl: "https://silverkey.ca"
    });
    expect(submitted.status).toBe("submitted");
    expect(submitted.consentedAt).toBe(submitted.submittedAt);
    expect(submitted.retainUntil).not.toBeNull();
    expect(submitted.files[0].scanStatus).toBe("manual_review_required");
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0][0]).toMatchObject({
      to: "admin@example.test",
      idempotencyKey: `application-submitted-${applicationId}`
    });
    expect(send.mock.calls[0][0].text).toContain("https://silverkey.ca/admin/applications");
    expect(send.mock.calls[0][0].text).not.toContain("completed-application.pdf");
    await expect(uploadApplicationFile(client, applicationId, pdfFile()))
      .rejects.toMatchObject({ code: "APPLICATION_ALREADY_SUBMITTED" });
    const receipt = (await applicationReceipt(client, applicationId)).toString("utf8");
    expect(receipt).toContain(application.termsSha256);
    expect(receipt).toContain("completed-application.pdf");
  });

  it("keeps a completed submission when the admin notification provider fails", async () => {
    await saveCompleteDraft();
    await uploadApplicationFile(client, applicationId, pdfFile());
    const application = await getClientApplication(client, applicationId);
    const submitted = await submitClientApplication(client, applicationId, {
      sharingAuthorization: true,
      screeningConsent: true,
      termsVersion: application.termsVersion,
      termsSha256: application.termsSha256,
      formVersion: application.formVersion,
      formSha256: application.formSha256
    }, { requestId: "test-request", userAgentHash: "test-agent-hash" }, {
      notifier: { send: vi.fn().mockRejectedValue(new Error("provider unavailable")) },
      recipient: "admin@example.test"
    });
    expect(submitted.status).toBe("submitted");
  });

  it("allows only documented staff status transitions", async () => {
    await saveCompleteDraft();
    await uploadApplicationFile(client, applicationId, pdfFile());
    const application = await getClientApplication(client, applicationId);
    await submitClientApplication(client, applicationId, {
      sharingAuthorization: true, screeningConsent: true,
      termsVersion: application.termsVersion, termsSha256: application.termsSha256,
      formVersion: application.formVersion, formSha256: application.formSha256
    }, { requestId: "test", userAgentHash: "hash" });
    const admin = { userId: crypto.randomUUID(), email: "admin@example.test", displayName: "Admin", authenticatedAt: new Date().toISOString(), assuranceLevel: "aal2" as const };
    await expect(updateApplicationStatus(admin, applicationId, "approved"))
      .rejects.toMatchObject({ code: "INVALID_APPLICATION_STATUS" });
    expect((await updateApplicationStatus(admin, applicationId, "received")).status).toBe("received");
    await expect(updateApplicationStatus(admin, applicationId, "under_review"))
      .rejects.toMatchObject({ code: "APPLICATION_FILES_NOT_CLEARED" });
    const fileId = application.files[0].id;
    expect((await getApplicationFileForStaff(admin, fileId)).bytes.toString("utf8")).toContain("%PDF");
    expect((await reviewApplicationFile(admin, fileId, "cleared")).scanStatus).toBe("cleared");
    expect((await updateApplicationStatus(admin, applicationId, "under_review")).status).toBe("under_review");

    const approvalSend = vi.fn<EmailProvider["send"]>().mockResolvedValue({
      providerMessageId: "resend-approval-test",
      status: "queued"
    });
    const approved = await updateApplicationStatus(admin, applicationId, "approved", {
      notifier: { send: approvalSend }
    });
    expect(approved.status).toBe("approved");
    expect(approved.applicantNotification.status).toBe("queued");
    expect(approvalSend).toHaveBeenCalledWith(expect.objectContaining({
      to: "client@example.test",
      idempotencyKey: `application-approved-${applicationId}`,
      subject: expect.stringContaining("approved")
    }));
    expect(approvalSend.mock.calls[0][0].text).toContain("will contact you");
    expect(approvalSend.mock.calls[0][0].text).toContain("does not create a tenancy");

    const conversionInput = {
      propertyLabel: "1231 Howe Street",
      unitLabel: "1104",
      moveInDate: "2026-09-01",
      leaseType: "fixed_term" as const,
      leaseEndDate: "2027-08-31",
      rentDueDay: 1
    };
    await expect(convertApprovedApplicationToTenant(admin, applicationId, conversionInput))
      .rejects.toMatchObject({ code: "SIGNED_LEASE_REQUIRED" });
    await expect(uploadSignedLeaseForStaff(
      admin,
      applicationId,
      pdfFile("%PDF-1.7\n/OpenAction /JavaScript")
    )).rejects.toMatchObject({ code: "UNSAFE_LEASE_FILE" });
    const signedLease = await uploadSignedLeaseForStaff(
      admin,
      applicationId,
      new File(["%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF"], "signed-tenancy-agreement.pdf", { type: "application/pdf" })
    );
    expect((await getSignedLeaseForStaff(admin, signedLease.id)).bytes.toString("utf8"))
      .toContain("%PDF-1.7");

    const converted = await convertApprovedApplicationToTenant(admin, applicationId, conversionInput);
    expect(converted.application.convertedTenantId).toBe(converted.tenant.id);
    expect(converted.tenant).toMatchObject({
      fullName: "Demo Applicant",
      email: "client@example.test",
      phoneE164: "+16045550182",
      leaseType: "fixed_term",
      isActive: true
    });
    expect((await convertApprovedApplicationToTenant(admin, applicationId, conversionInput)).tenant.id)
      .toBe(converted.tenant.id);
  });

  it("keeps approval recorded when applicant email delivery fails", async () => {
    await saveCompleteDraft();
    const uploaded = await uploadApplicationFile(client, applicationId, pdfFile());
    const application = await getClientApplication(client, applicationId);
    await submitClientApplication(client, applicationId, {
      sharingAuthorization: true, screeningConsent: true,
      termsVersion: application.termsVersion, termsSha256: application.termsSha256,
      formVersion: application.formVersion, formSha256: application.formSha256
    }, { requestId: "test", userAgentHash: "hash" });
    const admin = { userId: crypto.randomUUID(), email: "admin@example.test", displayName: "Admin", authenticatedAt: new Date().toISOString(), assuranceLevel: "aal2" as const };
    await reviewApplicationFile(admin, uploaded.id, "cleared");
    await updateApplicationStatus(admin, applicationId, "received");
    await updateApplicationStatus(admin, applicationId, "under_review");
    const approved = await updateApplicationStatus(admin, applicationId, "approved", {
      notifier: { send: vi.fn().mockRejectedValue(new Error("provider unavailable")) }
    });
    expect(approved.status).toBe("approved");
    expect(approved.applicantNotification.status).toBe("failed");
  });
});
