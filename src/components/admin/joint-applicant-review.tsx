"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { ClientApplicationRecord } from "@/features/applications/contracts";
import type { ApplicationNotificationApplicant } from "@/features/applications/notification";
import { applicationDraftSchema } from "@/features/applications/schemas";

const deliveryLabels = { scheduled: "Waiting to send", sent: "Sent", delivered: "Delivered", failed: "Delivery failed" };

function reviewApplicants(application: ClientApplicationRecord): ApplicationNotificationApplicant[] {
  const details = application.applicantDetails?.filter(applicant => applicant.status !== "revoked") ?? [];
  const applicants: ApplicationNotificationApplicant[] = [...details];
  for (const applicant of application.applicants.filter(item => item.status !== "revoked")) {
    if (!applicants.some(item => item.id === applicant.id)) applicants.push({ ...applicant, draft: applicant.role === "primary" ? application.draft : applicationDraftSchema.parse({}), files: [] });
  }
  if (!applicants.some(applicant => applicant.role === "primary")) applicants.unshift({
    id: `primary-${application.id}`, role: "primary", legalName: [application.draft.personal.legalFirstName, application.draft.personal.legalLastName].filter(Boolean).join(" ") || "Applicant", email: application.draft.personal.email, status: "in_progress", invitationExpiresAt: null, draftUpdatedAt: null, signedAt: application.consentedAt,
    draft: application.draft, files: []
  });
  return applicants.map(applicant => {
    const files = new Map([...applicant.files, ...application.files.filter(file => file.applicantId === applicant.id || (!file.applicantId && applicant.role === "primary"))].map(file => [file.id, file]));
    return { ...applicant, files: [...files.values()] };
  }).sort((a, b) => Number(b.role === "primary") - Number(a.role === "primary"));
}

function signedTime(value: string) {
  return new Date(value).toLocaleString("en-CA", { timeZone: "America/Vancouver", dateStyle: "medium", timeStyle: "short" });
}

export function JointApplicantReview({ application, renderDetails, renderFiles }: {
  application: ClientApplicationRecord;
  renderDetails: (applicant: ApplicationNotificationApplicant) => ReactNode;
  renderFiles: (applicant: ApplicationNotificationApplicant) => ReactNode;
}) {
  const applicants = reviewApplicants(application);
  const tenancy = application.draft.tenancy;
  const occupants = tenancy.adultCount !== null && tenancy.childCount !== null ? tenancy.adultCount + tenancy.childCount : tenancy.occupantCount;
  const assignedFileIds = new Set(applicants.flatMap(applicant => applicant.files.map(file => file.id)));
  const otherFiles = application.files.filter(file => !assignedFileIds.has(file.id));
  return <section className="joint-application-review" aria-label="Joint application and linked users">
    <dl className="joint-tenancy-summary">
      <div><dt>Requested tenancy</dt><dd>{tenancy.desiredMoveInDate || "Move-in not set"} · {tenancy.leaseTerm.replaceAll("_", " ") || "Term not set"}</dd></div>
      <div><dt>Household</dt><dd>{occupants} occupants · {tenancy.adultCount ?? "—"} adults · {tenancy.childCount ?? "—"} children</dd></div>
      <div><dt>Pets / parking</dt><dd>{tenancy.hasPets ? tenancy.petDetails || "Has pets" : "No pets"} · {tenancy.needsParking ? "Parking required" : "No parking"}</dd></div>
      {tenancy.reasonForChoosing && <div><dt>Property fit</dt><dd>{tenancy.reasonForChoosing}</dd></div>}
    </dl>
    <div className={`joint-applicant-cards${applicants.length === 1 ? " single-applicant" : ""}`}>{applicants.map(applicant => (
      <article key={applicant.id} className="joint-applicant-card" aria-label={`${applicant.legalName} application`}>
        <header className="joint-applicant-heading">
          <div><span>{applicant.role === "primary" ? "Primary applicant" : "Co-applicant"}</span><h3>{applicant.legalName}</h3></div>
          {applicant.userId && <Link href={`/admin/users/${applicant.userId}`}>View user ↗</Link>}
        </header>
        {applicant.role === "primary" || application.applicantDetails?.some(item => item.id === applicant.id)
          ? renderDetails(applicant)
          : <p>Personal details were not recorded for this applicant.</p>}
        <section className="joint-signed-content" aria-label={`${applicant.legalName} signed declaration`}>
          <h4>Signed declaration</h4>
          {applicant.signature ? <>
            <p className="joint-signature-record"><strong>{applicant.signature.legalName}</strong><time dateTime={applicant.signature.signedAt}>{signedTime(applicant.signature.signedAt)} PT</time></p>
            <dl><div><dt>Share with landlord</dt><dd>{applicant.signature.sharingAuthorized ? "Authorized" : "Not recorded"}</dd></div><div><dt>Reference, housing & income checks</dt><dd>{applicant.signature.screeningConsented ? "Consented" : "Not recorded"}</dd></div></dl>
            <details className="joint-signed-terms"><summary>Full signed terms · {applicant.signature.termsVersion}</summary><div>{applicant.signature.termsText.split("\n").filter(Boolean).map((line, index) => <p key={index}>{line}</p>)}</div></details>
          </> : <p>{applicant.signedAt ? `Signed ${signedTime(applicant.signedAt)} PT. Original declaration text is unavailable for this historical record.` : `Not signed · ${applicant.status.replaceAll("_", " ")}`}</p>}
          {applicant.files.some(file => file.documentType === "credit_score_report") && <p className="joint-report-confirmation">{applicant.creditReportVoluntaryAt ? "Credit report voluntarily provided by this applicant." : "Credit report voluntary confirmation not recorded."}</p>}
        </section>
        {renderFiles(applicant)}
        {applicant.role === "co_applicant" && !applicant.signedAt && <p className="joint-invitation-status">Invitation: {applicant.invitationDeliveryStatus ? deliveryLabels[applicant.invitationDeliveryStatus] : "Delivery not recorded"}{applicant.userId ? " · Account linked" : " · Waiting to accept"}</p>}
      </article>
    ))}</div>
    {otherFiles.length > 0 && <section className="joint-unassigned-files" aria-label="Other application attachments"><h3>Other application attachments</h3><p>These historical files are not linked to an applicant shown above.</p>{renderFiles({ ...applicants[0], files: otherFiles, draft: { ...applicants[0].draft, documentExplanations: { employment_income_proof: "", rental_payment_history: "", credit_score_report: "" } } })}</section>}
  </section>;
}
