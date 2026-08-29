import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCoApplicantInvitation,
  exchangeCoApplicantInvitation,
  getGuestApplication,
  getMemoryCreditCheckRequestsForTests,
  resendCoApplicantInvitation,
  revokeCoApplicant,
  saveGuestApplicantDraft,
  signGuestApplicant,
  uploadGuestApplicantFile,
} from "@/features/applications/applicant-signing";
import {
  getClientApplication,
  resetDemoApplicationsForTests,
  saveApplicationDraft,
  submitClientApplication,
  uploadApplicationFile,
} from "@/features/applications/service";
import { applicationDraftSchema } from "@/features/applications/schemas";
import type { ClientIdentity } from "@/features/applications/contracts";
import type { EmailProvider } from "@/features/notifications/providers/types";

const owner: ClientIdentity = {
  userId: "00000000-0000-4000-8000-000000000009",
  email: "client@example.test",
  displayName: "Demo Applicant",
};
const applicationId = "30000000-0000-4000-8000-000000000009";
const context = { requestId: "request-1", userAgentHash: "a".repeat(64), ipHash: "b".repeat(64) };

function completeDraft(email = "guest@example.test") {
  return applicationDraftSchema.parse({
    personal: { legalFirstName: "Guest", legalLastName: "Applicant", phone: "6045550182", email },
    tenancy: { desiredMoveInDate: "2026-09-01", leaseTerm: "one_year", adultCount: 2, childCount: 0, needsShowing: "no" },
    housing: { currentAddress: "10 Current Street", currentHousingSince: "2024-01", landlordName: "Landlord", landlordPhone: "6045550111", reasonForLeaving: "Moving closer to work." },
    employment: { employmentStatus: "employed", employerOrIncomeSource: "Example Co", occupation: "Designer", employmentSince: "2022-01", grossMonthlyIncome: 7000, contactName: "Manager", contactPhone: "6045550122" },
    references: { primary: { name: "Reference", relationship: "Manager", phone: "6045550133" } },
    emergency: { name: "Emergency", relationship: "Sibling", phone: "6045550144" },
    documentExplanations: {
      rental_payment_history: "The current landlord does not issue payment ledgers.",
      credit_score_report: "A credit report will be requested with my authorization.",
      employment_income_proof: "Income will be verified directly with my employer.",
    },
  });
}

beforeEach(() => {
  process.env.DATA_BACKEND = "memory";
  process.env.APP_BASE_URL = "https://example.test";
  resetDemoApplicationsForTests();
});

describe("multi-applicant signing", () => {
  it("requires invited, draft, and typed guest legal names to identify the same person", async () => {
    const invited = await createCoApplicantInvitation(owner, applicationId, {
      legalName: "Guest Applicant",
      email: "guest@example.test",
    }, context);
    const session = await exchangeCoApplicantInvitation(invited.invitationToken, context);
    const mismatchedDraft = completeDraft();
    mismatchedDraft.personal.legalFirstName = "Different";
    await expect(saveGuestApplicantDraft(session.sessionToken, { draft: mismatchedDraft, activeStep: 7 }, context))
      .rejects.toMatchObject({ code: "APPLICATION_APPLICANT_IDENTITY_MISMATCH" });

    await saveGuestApplicantDraft(session.sessionToken, { draft: completeDraft(), activeStep: 7 }, context);
    const application = await getClientApplication(owner, applicationId);
    await expect(signGuestApplicant(session.sessionToken, {
      signatureLegalName: "Different Person",
      sharingAuthorization: true,
      screeningConsent: true,
      termsVersion: application.termsVersion,
      termsSha256: application.termsSha256,
      formVersion: application.formVersion,
      formSha256: application.formSha256,
    }, context)).rejects.toMatchObject({ code: "APPLICATION_SIGNATURE_NAME_MISMATCH" });
  });

  it("exchanges an invitation once, scopes the guest session, and supports revoke/resend", async () => {
    const send = vi.fn<EmailProvider["send"]>().mockResolvedValue({ providerMessageId: "invite-1", status: "queued" });
    const invited = await createCoApplicantInvitation(owner, applicationId, {
      legalName: "Guest Applicant",
      email: "guest@example.test",
    }, context, { notifier: { send } });
    expect(invited.invitationToken).toBeTruthy();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      to: "guest@example.test",
      text: expect.stringContaining(`/application/guest#token=${invited.invitationToken}`),
    }));

    const session = await exchangeCoApplicantInvitation(invited.invitationToken, context);
    await expect(exchangeCoApplicantInvitation(invited.invitationToken, context))
      .rejects.toMatchObject({ code: "APPLICATION_INVITATION_USED" });
    expect((await getGuestApplication(session.sessionToken)).applicant.id).toBe(invited.applicant.id);

    const resent = await resendCoApplicantInvitation(owner, applicationId, invited.applicant.id, context);
    expect(resent.invitationToken).not.toBe(invited.invitationToken);
    await expect(getGuestApplication(session.sessionToken))
      .rejects.toMatchObject({ code: "APPLICATION_GUEST_SESSION_INVALID" });

    await revokeCoApplicant(owner, applicationId, invited.applicant.id, context);
    await expect(exchangeCoApplicantInvitation(resent.invitationToken, context))
      .rejects.toMatchObject({ code: "APPLICATION_INVITATION_REVOKED" });
  });

  it("records independent evidence, freezes shared edits, and queues one credit request per signer", async () => {
    await saveApplicationDraft(owner, applicationId, { draft: completeDraft(owner.email), activeStep: 7 });
    const invited = await createCoApplicantInvitation(owner, applicationId, {
      legalName: "Guest Applicant",
      email: "guest@example.test",
    }, context);
    const session = await exchangeCoApplicantInvitation(invited.invitationToken, context);
    const guestDraft = await saveGuestApplicantDraft(session.sessionToken, { draft: completeDraft(), activeStep: 7 }, context);
    expect(guestDraft.draft.tenancy.occupantCount).toBe(2);
    const application = await getClientApplication(owner, applicationId);

    await signGuestApplicant(session.sessionToken, {
      signatureLegalName: "Guest Applicant",
      sharingAuthorization: true,
      screeningConsent: true,
      termsVersion: application.termsVersion,
      termsSha256: application.termsSha256,
      formVersion: application.formVersion,
      formSha256: application.formSha256,
    }, context);

    await expect(saveApplicationDraft(owner, applicationId, { draft: completeDraft(owner.email), activeStep: 1 }))
      .rejects.toMatchObject({ code: "APPLICATION_SIGNATURES_LOCKED" });
    const pdf = new File(["%PDF-1.7\n%%EOF"], "proof.pdf", { type: "application/pdf" });
    await expect(uploadApplicationFile(owner, applicationId, pdf, "employment_income_proof"))
      .rejects.toMatchObject({ code: "APPLICATION_SIGNATURES_LOCKED" });
    await expect(uploadGuestApplicantFile(session.sessionToken, pdf, "employment_income_proof", context))
      .rejects.toMatchObject({ code: "APPLICATION_APPLICANT_SIGNED" });

    await expect(submitClientApplication(owner, applicationId, {
      signatureLegalName: "Wrong Name",
      sharingAuthorization: true,
      screeningConsent: true,
      termsVersion: application.termsVersion,
      termsSha256: application.termsSha256,
      formVersion: application.formVersion,
      formSha256: application.formSha256,
    }, context)).rejects.toMatchObject({ code: "APPLICATION_SIGNATURE_NAME_MISMATCH" });

    const adminSend = vi.fn<EmailProvider["send"]>().mockResolvedValue({ providerMessageId: "application-email", status: "queued" });
    const submitted = await submitClientApplication(owner, applicationId, {
      signatureLegalName: "Guest Applicant",
      sharingAuthorization: true,
      screeningConsent: true,
      termsVersion: application.termsVersion,
      termsSha256: application.termsSha256,
      formVersion: application.formVersion,
      formSha256: application.formSha256,
    }, context, { notifier: { send: adminSend }, recipient: "admin@example.test" });
    const creditRequests = getMemoryCreditCheckRequestsForTests(applicationId);
    expect(submitted.status).toBe("submitted");
    expect(creditRequests).toHaveLength(2);
    expect(new Set(creditRequests.map((request) => request.applicantId)).size).toBe(2);
    expect(new Set(creditRequests.map((request) => request.idempotencyKey)).size).toBe(2);
    expect(creditRequests.every((request) => request.status === "pending")).toBe(true);
    expect(adminSend).toHaveBeenCalledOnce();
    expect(adminSend.mock.calls[0][0].text).toContain("CO-APPLICANT 1");
    expect(adminSend.mock.calls[0][0].text.match(/Gross monthly income/g)).toHaveLength(2);
  });

  it("refuses final submit while an active co-applicant is unsigned", async () => {
    await saveApplicationDraft(owner, applicationId, { draft: completeDraft(owner.email), activeStep: 7 });
    await createCoApplicantInvitation(owner, applicationId, {
      legalName: "Guest Applicant",
      email: "guest@example.test",
    }, context);
    const application = await getClientApplication(owner, applicationId);
    await expect(submitClientApplication(owner, applicationId, {
      signatureLegalName: "Demo Applicant",
      sharingAuthorization: true,
      screeningConsent: true,
      termsVersion: application.termsVersion,
      termsSha256: application.termsSha256,
      formVersion: application.formVersion,
      formSha256: application.formSha256,
    }, context)).rejects.toMatchObject({ code: "APPLICATION_CO_APPLICANTS_UNSIGNED" });
  });
});
