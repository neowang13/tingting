import { beforeEach, describe, expect, it, vi } from "vitest";
import { applicationDraftSchema } from "@/features/applications/schemas";
import { createCoApplicantInvitation, exchangeCoApplicantInvitation, assertGuestAccount, resumeCoApplicantApplication,
  getGuestApplication, getApplicationApplicants, saveGuestApplicantDraft, signGuestApplicant, uploadGuestApplicantFile } from "@/features/applications/applicant-signing";
import { getClientApplication, listClientApplications, listApplicationsForStaff, resetDemoApplicationsForTests, saveApplicationDraft } from "@/features/applications/service";
import { deliverOwnerNotifications } from "@/features/notifications/owner-notifications";
import { store } from "@/data/store";
import { resetRepositoryForTests } from "@/data/repository";
import type { ClientIdentity } from "@/features/applications/contracts";

const owner: ClientIdentity = { userId: "00000000-0000-4000-8000-000000000009", email: "client@example.test", displayName: "Primary Applicant" };
const second: ClientIdentity = { userId: "00000000-0000-4000-8000-000000000010", email: "second@example.test", displayName: "Second Applicant" };
const id = "30000000-0000-4000-8000-000000000009";
const context = { requestId: "test", userAgentHash: "a".repeat(64) };
const admin = { userId: "admin", email: "admin@example.test", displayName: "Admin", authenticatedAt: new Date().toISOString(), assuranceLevel: "aal2" as const };
function draft(identity = owner) {
  return applicationDraftSchema.parse({
    personal: { legalFirstName: identity === owner ? "Primary" : "Second", legalLastName: "Applicant", email: identity.email, phone: "6045550100" },
    tenancy: { desiredMoveInDate: "2026-12-01", adultCount: 2, childCount: 0, leaseTerm: "one_year", needsShowing: "no" },
    housing: { currentAddress: identity === owner ? "Private primary address" : "Private second address", currentHousingSince: "2024-01", landlordName: "Test Landlord", landlordPhone: "6045550101", reasonForLeaving: "Moving closer to work" },
    employment: { employmentStatus: "employed", employerOrIncomeSource: "Test Employer", occupation: "Manager", employmentSince: "2020-01", grossMonthlyIncome: 8000, contactName: "Test Boss", contactPhone: "6045550102" },
    references: { primary: { name: "Reference", relationship: "Colleague", phone: "6045550103" } }, emergency: { name: "Emergency", relationship: "Sibling", phone: "6045550104" },
    documentExplanations: { rental_payment_history: "Fictional test explanation", credit_score_report: "No report available in this test", employment_income_proof: "Fictional test explanation" }
  });
}
beforeEach(async () => {
  process.env.DATA_BACKEND = "memory"; process.env.EMAIL_PROVIDER_MODE = "mock";
  store.reset(); resetRepositoryForTests(); resetDemoApplicationsForTests();
  await saveApplicationDraft(owner, id, { draft: draft(), activeStep: 7 });
});
async function invite() { return createCoApplicantInvitation(owner, id, { legalName: second.displayName, email: second.email }, context); }

describe("linked joint application accounts", () => {
  it("retains a failed invitation and retries the same token without losing the co-applicant", async () => {
    const failed = vi.fn().mockRejectedValue(new Error("provider unavailable"));
    const created = await createCoApplicantInvitation(owner, id, { legalName: second.displayName, email: second.email }, context, { notifier: { send: failed } });
    expect(created.applicant.invitationDeliveryStatus).toBe("failed");
    expect((await getApplicationApplicants(owner, id)).some(a => a.id === created.applicant.id)).toBe(true);
    const send = vi.fn().mockResolvedValue({ providerMessageId: "retried-invite", status: "queued" });
    const result = await deliverOwnerNotifications({ now: new Date(Date.now() + 61_000), provider: { send } });
    expect(result.sent).toBe(1);
    expect(send.mock.calls[0][0].text).toContain(created.invitationToken);
    expect((await getApplicationApplicants(owner, id)).find(a => a.id === created.applicant.id)?.invitationDeliveryStatus).toBe("sent");
  });

  it("rejects a wrong email without consuming the invitation and limits resume to its linked user", async () => {
    const created = await invite();
    await expect(exchangeCoApplicantInvitation(created.invitationToken, context, owner)).rejects.toMatchObject({ code: "APPLICATION_INVITATION_ACCOUNT_MISMATCH" });
    const session = await exchangeCoApplicantInvitation(created.invitationToken, context, second);
    await expect(assertGuestAccount(session.sessionToken, owner)).rejects.toMatchObject({ status: 403 });
    await expect(assertGuestAccount(session.sessionToken, second)).resolves.toBeUndefined();
    await expect(resumeCoApplicantApplication(owner, created.applicant.id)).rejects.toMatchObject({ status: 404 });
    const resumed = await resumeCoApplicantApplication(second, created.applicant.id);
    expect((await getGuestApplication(resumed.sessionToken)).applicant.userId).toBe(second.userId);
  });

  it("lists the joint application for both accounts and never exposes primary private data to the second account", async () => {
    const created = await invite();
    const session = await exchangeCoApplicantInvitation(created.invitationToken, context, second);
    const candidate = draft(second); candidate.tenancy.adultCount = 9;
    const saved = await saveGuestApplicantDraft(session.sessionToken, { draft: candidate, activeStep: 5 }, context);
    expect(saved.draft.tenancy.adultCount).toBe(2);
    expect(saved.draft.tenancy.occupantCount).toBe(2);
    expect(JSON.stringify(await getGuestApplication(session.sessionToken))).not.toContain("Private primary address");
    expect(await listClientApplications(second)).toEqual([expect.objectContaining({ id, participatingApplicantId: created.applicant.id })]);
    expect(JSON.stringify(await listClientApplications(second))).not.toContain("Private primary address");
    const staff = (await listApplicationsForStaff(admin))[0];
    expect(staff.applicantDetails?.map(a => a.userId)).toEqual([owner.userId, second.userId]);
    expect(staff.applicantDetails?.find(a => a.userId === second.userId)?.draft.housing.currentAddress).toBe("Private second address");
  });

  it("requires personal voluntary confirmation for an uploaded report and records it only at signing", async () => {
    const created = await invite();
    const session = await exchangeCoApplicantInvitation(created.invitationToken, context, second);
    const creditOnlyDraft = draft(second);
    creditOnlyDraft.documentExplanations = { rental_payment_history: "", employment_income_proof: "", credit_score_report: "" };
    await saveGuestApplicantDraft(session.sessionToken, { draft: creditOnlyDraft, activeStep: 5 }, context);
    await uploadGuestApplicantFile(session.sessionToken, new File(["%PDF-1.4\n%%EOF"], "test-credit.pdf", { type: "application/pdf" }), "credit_score_report", context);
    const app = await getClientApplication(owner, id);
    const signature = { signatureLegalName: "Second Applicant", sharingAuthorization: true as const, screeningConsent: true as const, termsVersion: app.termsVersion, termsSha256: app.termsSha256, formVersion: app.formVersion, formSha256: app.formSha256 };
    await expect(signGuestApplicant(session.sessionToken, signature, context)).rejects.toMatchObject({ code: "CREDIT_REPORT_CONFIRMATION_REQUIRED" });
    await saveGuestApplicantDraft(session.sessionToken, { draft: { ...creditOnlyDraft, creditReportVoluntary: true }, activeStep: 6 }, context);
    expect((await getGuestApplication(session.sessionToken)).applicant.creditReportVoluntaryAt).toBeNull();
    const signed = await signGuestApplicant(session.sessionToken, signature, context);
    expect(signed).toMatchObject({ userId: second.userId, creditReportConsentVersion: "2026-10-15.1", creditReportVoluntaryAt: expect.any(String) });
    expect((await getApplicationApplicants(owner, id))[0].creditReportVoluntaryAt).toBeUndefined();
  });

  it("still requires the co-applicant credit report category even when optional document explanations are present", async () => {
    const created = await invite();
    const session = await exchangeCoApplicantInvitation(created.invitationToken, context, second);
    const candidate = draft(second);
    candidate.documentExplanations.credit_score_report = "";
    await saveGuestApplicantDraft(session.sessionToken, { draft: candidate, activeStep: 5 }, context);
    const app = await getClientApplication(owner, id);
    await expect(signGuestApplicant(session.sessionToken, {
      signatureLegalName: "Second Applicant", sharingAuthorization: true, screeningConsent: true,
      termsVersion: app.termsVersion, termsSha256: app.termsSha256,
      formVersion: app.formVersion, formSha256: app.formSha256
    }, context)).rejects.toMatchObject({ code: "APPLICATION_DOCUMENTS_REQUIRED" });
  });
});
