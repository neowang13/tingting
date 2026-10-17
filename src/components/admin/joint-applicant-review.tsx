"use client";

import Link from "next/link";
import { useId, useRef, useState, type ReactNode, type KeyboardEvent } from "react";
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = applicants.find(applicant => applicant.id === selectedId) ?? applicants[0];
  const selectedIndex = applicants.findIndex(applicant => applicant.id === selected.id);
  const switcherRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const tabsId = useId();
  const panelId = `${tabsId}-panel`;

  function selectApplicant(index: number, focus = false) {
    setSelectedId(applicants[index].id);
    const tab = tabRefs.current[index];
    if (focus) tab?.focus({ preventScroll: true });
    const strip = tab?.parentElement;
    if (tab && strip) {
      const bounds = tab.getBoundingClientRect();
      const visible = strip.getBoundingClientRect();
      if (bounds.left < visible.left) strip.scrollLeft -= visible.left - bounds.left + 3;
      else if (bounds.right > visible.right) strip.scrollLeft += bounds.right - visible.right + 3;
    }
    const scroller = switcherRef.current?.closest(".application-review-content");
    if (scroller) scroller.scrollTop = 0;
  }

  function handleTabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === "ArrowRight" ? (index + 1) % applicants.length
      : event.key === "ArrowLeft" ? (index - 1 + applicants.length) % applicants.length
      : event.key === "Home" ? 0 : event.key === "End" ? applicants.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    selectApplicant(next, true);
  }

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
    <div className="joint-applicant-switcher" ref={switcherRef}>
      <div className="joint-applicant-switcher-caption"><span>{applicants.length} {applicants.length === 1 ? "applicant" : "applicants"}</span><span>Viewing {selectedIndex + 1} of {applicants.length}</span></div>
      <div className="joint-applicant-tabs" role="tablist" aria-label="Choose applicant" aria-orientation="horizontal">
        {applicants.map((applicant, index) => <button key={applicant.id} id={`${tabsId}-${applicant.id}`} ref={element => { tabRefs.current[index] = element; }} type="button" role="tab" aria-selected={applicant.id === selected.id} aria-controls={panelId} tabIndex={applicant.id === selected.id ? 0 : -1} onClick={() => selectApplicant(index)} onKeyDown={event => handleTabKey(event, index)}>
          <strong>{applicant.legalName}</strong><span>{applicant.role === "primary" ? "Primary applicant" : "Co-applicant"}</span>
        </button>)}
      </div>
    </div>
    <div className="joint-applicant-panel" id={panelId} role="tabpanel" aria-labelledby={`${tabsId}-${selected.id}`} tabIndex={0}>
      <article key={selected.id} className="joint-applicant-card" aria-label={`${selected.legalName} application`}>
        <header className="joint-applicant-heading">
          <div><span>{selected.role === "primary" ? "Primary applicant" : "Co-applicant"}</span><h3>{selected.legalName}</h3></div>
          {selected.userId && <Link href={`/admin/users/${selected.userId}`}>View user ↗</Link>}
        </header>
        {selected.role === "primary" || application.applicantDetails?.some(item => item.id === selected.id)
          ? renderDetails(selected)
          : <p>Personal details were not recorded for this applicant.</p>}
        <section className="joint-signed-content" aria-label={`${selected.legalName} signed declaration`}>
          <h4>Signed declaration</h4>
          {selected.signature ? <>
            <p className="joint-signature-record"><strong>{selected.signature.legalName}</strong><time dateTime={selected.signature.signedAt}>{signedTime(selected.signature.signedAt)} PT</time></p>
            <dl><div><dt>Share with landlord</dt><dd>{selected.signature.sharingAuthorized ? "Authorized" : "Not recorded"}</dd></div><div><dt>Reference, housing & income checks</dt><dd>{selected.signature.screeningConsented ? "Consented" : "Not recorded"}</dd></div></dl>
            <details className="joint-signed-terms"><summary>Full signed terms · {selected.signature.termsVersion}</summary><div>{selected.signature.termsText.split("\n").filter(Boolean).map((line, index) => <p key={index}>{line}</p>)}</div></details>
          </> : <p>{selected.signedAt ? `Signed ${signedTime(selected.signedAt)} PT. Original declaration text is unavailable for this historical record.` : `Not signed · ${selected.status.replaceAll("_", " ")}`}</p>}
          {selected.files.some(file => file.documentType === "credit_score_report") && <p className="joint-report-confirmation">{selected.creditReportVoluntaryAt ? "Credit report voluntarily provided by this applicant." : "Credit report voluntary confirmation not recorded."}</p>}
        </section>
        {renderFiles(selected)}
        {selected.role === "co_applicant" && !selected.signedAt && <p className="joint-invitation-status">Invitation: {selected.invitationDeliveryStatus ? deliveryLabels[selected.invitationDeliveryStatus] : "Delivery not recorded"}{selected.userId ? " · Account linked" : " · Waiting to accept"}</p>}
      </article>
    </div>
    {otherFiles.length > 0 && <section className="joint-unassigned-files" aria-label="Other application attachments"><h3>Other application attachments</h3><p>These historical files are not linked to an applicant shown above.</p>{renderFiles({ ...applicants[0], files: otherFiles, draft: { ...applicants[0].draft, documentExplanations: { employment_income_proof: "", rental_payment_history: "", credit_score_report: "" } } })}</section>}
  </section>;
}
