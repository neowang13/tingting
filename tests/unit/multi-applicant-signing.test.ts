import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCoApplicantInvitation,
  exchangeCoApplicantInvitation as exchangeInvitation,
  getGuestApplication,
  getMemoryCreditCheckRequestsForTests,
  resendCoApplicantInvitation,
  revokeCoApplicant,
  saveGuestApplicantDraft,
  signGuestApplicant,
  uploadGuestApplicantFile,
  removeGuestApplicantFile,
} from "@/features/applications/applicant-signing";
import {
  getClientApplication,
  resetDemoApplicationsForTests,
  saveApplicationDraft,
  submitClientApplication,
  uploadApplicationFile,
  removeApplicationFile,
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

const coUser: ClientIdentity = { userId: "00000000-0000-4000-8000-000000000010", email: "guest@example.test", displayName: "Guest Applicant" };
function exchangeCoApplicantInvitation(token: string, context: Parameters<typeof exchangeInvitation>[1]) { return exchangeInvitation(token, context, coUser); }

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

beforeEach(async () => {
  process.env.DATA_BACKEND = "memory";
  process.env.APP_BASE_URL = "https://example.test";
  resetDemoApplicationsForTests();
  await saveApplicationDraft(owner, applicationId, { draft: completeDraft(owner.email), activeStep: 7 });
});

describe("multi-applicant signing", () => {
  it("scopes file removal to the invited account and its own documents", async () => {
    const invited = await createCoApplicantInvitation(owner, applicationId, { legalName: "Guest Applicant", email: coUser.email }, context);
    const session = await exchangeCoApplicantInvitation(invited.invitationToken, context);
    const pdf = new File(["%PDF-1.7\n%%EOF"], "wrong.pdf", { type: "application/pdf" });
    const primaryFile = await uploadApplicationFile(owner, applicationId, pdf, "other");
    const guestFile = await uploadGuestApplicantFile(session.sessionToken, pdf, "credit_score_report", context);
    await expect(removeGuestApplicantFile(session.sessionToken, guestFile.id, owner, context)).rejects.toMatchObject({ status: 403 });
    await expect(removeGuestApplicantFile(session.sessionToken, primaryFile.id, coUser, context)).rejects.toMatchObject({ code: "APPLICATION_FILE_NOT_FOUND" });
    await expect(removeApplicationFile(owner, applicationId, guestFile.id, context)).rejects.toMatchObject({ code: "APPLICATION_FILE_NOT_FOUND" });
    await removeGuestApplicantFile(session.sessionToken, guestFile.id, coUser, context);
    expect((await getGuestApplication(session.sessionToken)).applicant.files).toHaveLength(0);
    expect((await getClientApplication(owner, applicationId)).files).toHaveLength(1);
    await expect(removeGuestApplicantFile(session.sessionToken, guestFile.id, coUser, context)).rejects.toMatchObject({ code: "APPLICATION_FILE_NOT_FOUND" });
    await expect(uploadGuestApplicantFile(session.sessionToken, pdf, "credit_score_report", context)).resolves.toMatchObject({ documentType: "credit_score_report" });
  });
  it("lets the verified invitee correct their legal name and requires the signature to match their saved details", async () => {
    await saveApplicationDraft(owner, applicationId, { draft: completeDraft(owner.email), activeStep: 7 });
    const invited = await createCoApplicantInvitation(owner, applicationId, {
      legalName: "Guest Applicant",
      email: "guest@example.test",
    }, context);
    const session = await exchangeCoApplicantInvitation(invited.invitationToken, context);
    const mismatchedDraft = completeDraft();
    mismatchedDraft.personal.legalFirstName = "Corrected";
    await saveGuestApplicantDraft(session.sessionToken, { draft: mismatchedDraft, activeStep: 1 }, context);
    expect((await getGuestApplication(session.sessionToken)).applicant.legalName).toBe("Corrected Applicant");

    const application = await getClientApplication(owner, applicationId);
    const signature = {
      signatureLegalName: "Guest Applicant",
      sharingAuthorization: true as const,
      screeningConsent: true as const,
      termsVersion: application.termsVersion,
      termsSha256: application.termsSha256,
      formVersion: application.formVersion,
      formSha256: application.formSha256,
    };
    await expect(signGuestApplicant(session.sessionToken, signature, context))
      .rejects.toMatchObject({ code: "APPLICATION_SIGNATURE_NAME_MISMATCH" });
    await expect(signGuestApplicant(session.sessionToken, { ...signature, signatureLegalName: "  CORRECTED   Applicant  " }, context))
      .resolves.toMatchObject({ legalName: "Corrected Applicant", status: "signed" });
    await expect(saveGuestApplicantDraft(session.sessionToken, { draft: completeDraft(), activeStep: 1 }, context))
      .rejects.toMatchObject({ code: "APPLICATION_APPLICANT_SIGNED" });
    expect((await getGuestApplication(session.sessionToken)).applicant.legalName).toBe("Corrected Applicant");
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
      text: expect.stringContaining(`#token=${invited.invitationToken}`),
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

  it("records independent evidence, freezes changed shared edits, and never queues external credit requests", async () => {
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

    await expect(saveApplicationDraft(owner, applicationId, { draft: completeDraft(owner.email), activeStep: 1 })).resolves.toMatchObject({ draft: expect.any(Object) });
    const personalDraft = completeDraft(owner.email); personalDraft.housing.currentAddress = "Changed address";
    await expect(saveApplicationDraft(owner, applicationId, { draft: personalDraft, activeStep: 3 })).resolves.toMatchObject({ draft: { housing: { currentAddress: "Changed address" } } });
    const changedDraft = completeDraft(owner.email); changedDraft.tenancy.adultCount = 3;
    await expect(saveApplicationDraft(owner, applicationId, { draft: changedDraft, activeStep: 1 }))
      .rejects.toMatchObject({ code: "APPLICATION_SIGNATURES_LOCKED" });
    const pdf = new File(["%PDF-1.7\n%%EOF"], "proof.pdf", { type: "application/pdf" });
    await expect(uploadApplicationFile(owner, applicationId, pdf, "employment_income_proof"))
      .resolves.toMatchObject({ documentType: "employment_income_proof" });
    await expect(uploadGuestApplicantFile(session.sessionToken, pdf, "employment_income_proof", context))
      .rejects.toMatchObject({ code: "APPLICATION_APPLICANT_SIGNED" });
    await expect(removeGuestApplicantFile(session.sessionToken, crypto.randomUUID(), coUser, context)).rejects.toMatchObject({ code: "APPLICATION_APPLICANT_SIGNED" });

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
    expect(creditRequests).toEqual([]);
    expect(adminSend).toHaveBeenCalledOnce();
    expect(adminSend.mock.calls[0][0].text).toContain("CO-APPLICANT 1");
    expect(adminSend.mock.calls[0][0].text.match(/Gross monthly income/g)).toHaveLength(2);
  });

  it("records the primary signature, waits without notifying, then submits once the last co-applicant signs", async () => {
    const household = completeDraft(owner.email); household.tenancy.adultCount = 3;
    await saveApplicationDraft(owner, applicationId, { draft: household, activeStep: 2 });
    const invited = await createCoApplicantInvitation(owner, applicationId, {
      legalName: "Guest Applicant", email: "guest@example.test",
    }, context);
    const thirdUser = { ...coUser, userId: "00000000-0000-4000-8000-000000000011", email: "third@example.test", displayName: "Third Applicant" };
    const thirdInvite = await createCoApplicantInvitation(owner, applicationId, { legalName: "Third Applicant", email: thirdUser.email }, context);
    const thirdSession = await exchangeInvitation(thirdInvite.invitationToken, context, thirdUser);
    const session = await exchangeCoApplicantInvitation(invited.invitationToken, context);
    const application = await getClientApplication(owner, applicationId);
    const signature = {
      signatureLegalName: "Guest Applicant", sharingAuthorization: true as const, screeningConsent: true as const,
      termsVersion: application.termsVersion, termsSha256: application.termsSha256,
      formVersion: application.formVersion, formSha256: application.formSha256,
    };
    const send = vi.fn<EmailProvider["send"]>().mockResolvedValue({ providerMessageId: "complete-application", status: "queued" });
    const waiting = await submitClientApplication(owner, applicationId, signature, context, {
      notifier: { send }, recipient: "admin@example.test",
    });
    expect(waiting.status).toBe("draft");
    await expect(removeApplicationFile(owner, applicationId, crypto.randomUUID(), context)).rejects.toMatchObject({ code: "APPLICATION_SIGNATURES_LOCKED" });
    expect(waiting.submittedAt).toBeNull();
    expect(waiting.applicants.find(a => a.role === "primary")).toMatchObject({ status: "signed", signedAt: expect.any(String) });
    expect(send).not.toHaveBeenCalled();
    await expect(saveApplicationDraft(owner, applicationId, {
      draft: { ...completeDraft(owner.email), housing: { ...completeDraft().housing, currentAddress: "Changed after signing" } }, activeStep: 3,
    })).rejects.toMatchObject({ code: "APPLICATION_SIGNATURES_LOCKED" });
    await expect(revokeCoApplicant(owner, applicationId, invited.applicant.id, context))
      .rejects.toMatchObject({ code: "APPLICATION_SIGNATURES_LOCKED" });
    await expect(createCoApplicantInvitation(owner, applicationId, { legalName: "Extra Adult", email: "extra@example.test" }, context))
      .rejects.toMatchObject({ code: "APPLICATION_SIGNATURES_LOCKED" });
    await expect(submitClientApplication(owner, applicationId, signature, context)).resolves.toMatchObject({ status: "draft" });
    expect(send).not.toHaveBeenCalled();
    const thirdDraft = completeDraft(thirdUser.email); thirdDraft.personal.legalFirstName = "Third";
    await saveGuestApplicantDraft(thirdSession.sessionToken, { draft: thirdDraft, activeStep: 6 }, context);
    await signGuestApplicant(thirdSession.sessionToken, { ...signature, signatureLegalName: "Third Applicant" }, context);
    expect((await getClientApplication(owner, applicationId)).status).toBe("draft");
    expect(send).not.toHaveBeenCalled();
    const corrected = completeDraft(); corrected.personal.legalFirstName = "Corrected";
    corrected.documentExplanations.rental_payment_history = "";
    corrected.documentExplanations.employment_income_proof = "";
    await saveGuestApplicantDraft(session.sessionToken, { draft: corrected, activeStep: 6 }, context);
    await signGuestApplicant(session.sessionToken, { ...signature, signatureLegalName: "Corrected Applicant" }, context);
    const submitted = await getClientApplication(owner, applicationId);
    expect(submitted).toMatchObject({ status: "submitted", submittedAt: expect.any(String) });
    expect(submitted.applicants.every(a => a.status === "signed")).toBe(true);
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0][0].text).toContain("Corrected Applicant");
    await expect(signGuestApplicant(session.sessionToken, { ...signature, signatureLegalName: "Corrected Applicant" }, context))
      .rejects.toMatchObject({ code: "APPLICATION_APPLICANT_SIGNED" });
    expect(send).toHaveBeenCalledOnce();
  });

  it("rejects missing adult places before anyone signs and limits invitations to saved capacity", async () => {
    const application = await getClientApplication(owner, applicationId);
    const signature = {
      signatureLegalName: "Guest Applicant", sharingAuthorization: true as const, screeningConsent: true as const,
      termsVersion: application.termsVersion, termsSha256: application.termsSha256,
      formVersion: application.formVersion, formSha256: application.formSha256,
    };
    await expect(submitClientApplication(owner, applicationId, signature, context))
      .rejects.toMatchObject({ code: "APPLICATION_APPLICANT_COUNT_MISMATCH" });
    const solo = completeDraft(owner.email); solo.tenancy.adultCount = 1;
    await saveApplicationDraft(owner, applicationId, { draft: solo, activeStep: 2 });
    await expect(createCoApplicantInvitation(owner, applicationId, { legalName: "Guest Applicant", email: "guest@example.test" }, context))
      .rejects.toMatchObject({ code: "APPLICATION_ADULT_COUNT_REQUIRED" });
    await saveApplicationDraft(owner, applicationId, { draft: completeDraft(owner.email), activeStep: 2 });
    const invited = await createCoApplicantInvitation(owner, applicationId, { legalName: "Guest Applicant", email: "guest@example.test" }, context);
    await expect(createCoApplicantInvitation(owner, applicationId, { legalName: "Extra Adult", email: "extra@example.test" }, context))
      .rejects.toMatchObject({ code: "APPLICATION_APPLICANT_CAPACITY" });
    await revokeCoApplicant(owner, applicationId, invited.applicant.id, context);
    await expect(createCoApplicantInvitation(owner, applicationId, { legalName: "Replacement Adult", email: "replacement@example.test" }, context))
      .resolves.toMatchObject({ applicant: { status: "invited" } });
  });
});
