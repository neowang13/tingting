"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import type { ClientApplicationRecord } from "@/features/applications/contracts";
import type { ApplicationNotificationApplicant } from "@/features/applications/notification";

const deliveryLabels = { scheduled: "Waiting to send", sent: "Sent", delivered: "Delivered", failed: "Delivery failed" };

export function JointApplicantReview({ application, renderDetails }: {
  application: ClientApplicationRecord; renderDetails: (applicant: ApplicationNotificationApplicant) => ReactNode;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const applicants = application.applicantDetails ?? [];
  const selected = applicants.find(a => a.id === selectedId);
  const tenancy = application.draft.tenancy;
  const occupants = tenancy.adultCount !== null && tenancy.childCount !== null ? tenancy.adultCount + tenancy.childCount : tenancy.occupantCount;
  return <section className="joint-application-review" aria-label="Joint application and linked users">
    <div className="joint-tenancy-summary">
      <div><small>Requested tenancy</small><strong>{tenancy.desiredMoveInDate || "Not set"}</strong><span>{tenancy.leaseTerm.replaceAll("_", " ")}</span></div>
      <div><small>Household total</small><strong>{occupants} occupants</strong><span>{tenancy.adultCount ?? "—"} adults · {tenancy.childCount ?? "—"} children</span></div>
      <div><small>Linked User accounts</small><strong>{applicants.filter(a => a.userId).length} users</strong><span>One joint application</span></div>
      <div><small>Tenant status</small><strong>{application.convertedAt && application.leaseDocument ? "Confirmed signed lease" : "Not yet tenants"}</strong><span>Separate confirmation after the lease is signed</span></div>
    </div>
    <h3>Applicants</h3>
    <div className="joint-applicant-cards">{applicants.map(applicant => {
      const reportFiles = applicant.files.filter(file => file.documentType === "credit_score_report");
      return <article key={applicant.id} className="joint-applicant-card">
        <div className="joint-applicant-heading"><div><small>{applicant.role === "primary" ? "Primary applicant" : "Co-applicant"}</small><h4>{applicant.legalName}</h4></div>
          {applicant.userId ? <Link href={`/admin/users/${applicant.userId}`}>View user ↗</Link> : <span className="joint-waiting">Account not linked</span>}</div>
        <p>{applicant.email}</p>
        <div className="joint-applicant-signature"><span>Application signature</span><strong>{applicant.signedAt ? `Signed · ${new Date(applicant.signedAt).toLocaleDateString("en-CA", { timeZone: "America/Vancouver" })}` : applicant.status.replaceAll("_", " ")}</strong></div>
        <section className="joint-credit-report"><strong>Credit score report</strong>
          {reportFiles.length ? reportFiles.map(file => <div className="joint-credit-file" key={file.id}><span>{file.originalFilename}<small>{file.scanStatus === "cleared" ? "Staff review complete" : file.scanStatus === "rejected" ? "Rejected by staff" : "Awaiting staff review"}</small></span><a href={`/api/admin/application-files/${file.id}`}>Open report ↗</a></div>) : <p>No report uploaded{applicant.draft.documentExplanations.credit_score_report ? "; explanation provided" : ""}.</p>}
          {reportFiles.length > 0 && <div className={`joint-report-confirmation${applicant.creditReportVoluntaryAt ? " confirmed" : ""}`}>
            <strong>{applicant.creditReportVoluntaryAt ? `✓ Voluntarily provided by ${applicant.legalName}` : applicant.signedAt ? "Voluntary confirmation not recorded for this historical submission" : "Awaiting this applicant’s voluntary confirmation at signing"}</strong>
            {applicant.creditReportVoluntaryAt && <small>Confirmed at signing · {new Date(applicant.creditReportVoluntaryAt).toLocaleString("en-CA", { timeZone: "America/Vancouver" })}</small>}
            {applicant.creditReportConsentVersion && <small>Declaration version {applicant.creditReportConsentVersion}</small>}
          </div>}
        </section>
        {applicant.role === "co_applicant" && <p className="joint-invitation-status">Invitation email: <strong>{applicant.invitationDeliveryStatus ? deliveryLabels[applicant.invitationDeliveryStatus] : "Delivery not recorded"}</strong>{applicant.userId ? " · Account linked" : " · Waiting to accept"}</p>}
        <div className="joint-applicant-footer"><span>{applicant.files.length} supporting files</span><button type="button" className="text-button" onClick={() => setSelectedId(applicant.id)}>View applicant details →</button></div>
      </article>;
    })}</div>
    {selected && <section className="joint-selected-applicant" aria-label={`${selected.legalName} details`}><div className="joint-applicant-heading"><h3>{selected.legalName} — personal details</h3><button type="button" className="text-button" onClick={() => setSelectedId(null)}>Close details</button></div>{renderDetails(selected)}</section>}
  </section>;
}
