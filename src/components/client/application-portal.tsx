"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useMemo, useState } from "react";
import type { ApplicationFileRecord, ClientApplicationRecord } from "@/features/applications/contracts";
import {
  applicationDraftStepComplete,
  applicationDraftStepIssues,
  type ApplicationDraft,
  type ApplicationDraftSection
} from "@/features/applications/schemas";
import { PUBLIC_CONTACT_EMAIL } from "@/lib/site-contact";

const steps: ReadonlyArray<{ label: string; section?: ApplicationDraftSection }> = [
  { label: "Personal details", section: "personal" },
  { label: "Household & tenancy", section: "tenancy" },
  { label: "Housing history", section: "housing" },
  { label: "Employment & income", section: "employment" },
  { label: "References", section: "references" },
  { label: "Emergency contact", section: "emergency" },
  { label: "Documents" },
  { label: "Review & submit" }
];

function statusLabel(status: ClientApplicationRecord["status"]) {
  return status.split("_").map((part) => part[0].toUpperCase() + part.slice(1)).join(" ");
}

async function responseMessage(response: Response) {
  try {
    const body = await response.json() as { error?: { message?: string } };
    return body.error?.message || "The request could not be completed.";
  } catch {
    return "The request could not be completed.";
  }
}

function Field({ label, children, wide = false, hint, group = false }: { label: string; children: ReactNode; wide?: boolean; hint?: string; group?: boolean }) {
  return <div className={`field${wide ? " application-field-wide" : ""}`}>{group ? <div role="group" aria-label={label}><span className="application-group-label">{label}</span>{children}</div> : <label><span>{label}</span>{children}</label>}{hint && <small className="field-hint">{hint}</small>}</div>;
}

function StepActions({
  step,
  busy,
  onBack,
  onExit,
  nextLabel = "Save and continue"
}: {
  step: number;
  busy: boolean;
  onBack: () => void;
  onExit: () => void;
  nextLabel?: string;
}) {
  return <div className="application-step-actions">
    <button className="button secondary" type="button" onClick={onBack} disabled={busy || step === 1}>Back</button>
    <button className="text-button" type="button" onClick={onExit} disabled={busy}>Save and exit</button>
    <button className="button" type="submit" disabled={busy}>{busy ? "Saving…" : nextLabel}</button>
  </div>;
}

function ReviewGroup({ title, rows, onEdit }: { title: string; rows: Array<[string, string]>; onEdit: () => void }) {
  return <section className="application-review-group"><div><h3>{title}</h3><button className="text-button" type="button" onClick={onEdit}>Edit</button></div><dl>{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || "—"}</dd></div>)}</dl></section>;
}

export function ApplicationPortal({ application, termsText }: { application: ClientApplicationRecord; termsText: string }) {
  const router = useRouter();
  const [activeStep, setActiveStep] = useState(1);
  const [draft, setDraft] = useState<ApplicationDraft>(application.draft);
  const [files, setFiles] = useState(application.files);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [lastSaved, setLastSaved] = useState(application.draftUpdatedAt);
  const editable = application.status === "draft";

  const completed = useMemo(() => steps.map((step, index) => {
    if (step.section) return applicationDraftStepComplete(draft, step.section);
    if (index === 6) return files.length > 0;
    return !editable;
  }), [draft, editable, files.length]);
  const completedCount = completed.slice(0, 7).filter(Boolean).length;

  function updateSection(section: ApplicationDraftSection, patch: Record<string, unknown>) {
    setDraft((current) => ({
      ...current,
      [section]: { ...current[section], ...patch }
    } as ApplicationDraft));
    setMessage("");
  }

  async function persistDraft(options: { step?: number; exit?: boolean; validate?: boolean } = {}) {
    const step = options.step ?? activeStep;
    setError("");
    setMessage("");
    if (options.validate && step <= 6) {
      const section = steps[step - 1].section!;
      const issues = applicationDraftStepIssues(draft, section);
      if (issues.length > 0) {
        setError(issues[0]);
        return false;
      }
    }
    if (options.validate && step === 7 && files.length === 0) {
      setError("Upload at least one supporting document before continuing.");
      return false;
    }
    setBusy(true);
    const response = await fetch(`/api/client/applications/${application.id}/draft`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draft, activeStep: step })
    });
    if (!response.ok) {
      setError(await responseMessage(response));
      setBusy(false);
      return false;
    }
    const body = await response.json() as { data?: { draftUpdatedAt?: string } };
    setLastSaved(body.data?.draftUpdatedAt ?? new Date().toISOString());
    setBusy(false);
    if (options.exit) {
      router.push("/client/applications");
    } else {
      setMessage("Application draft saved securely.");
    }
    return true;
  }

  async function continueStep(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await persistDraft({ validate: true })) {
      setActiveStep((current) => Math.min(8, current + 1));
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  async function uploadFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true); setError(""); setMessage("");
    const response = await fetch(`/api/client/applications/${application.id}/files`, { method: "POST", body: new FormData(form) });
    if (!response.ok) {
      setError(await responseMessage(response));
    } else {
      const body = await response.json() as { data: ApplicationFileRecord };
      setFiles((current) => [...current, body.data]);
      form.reset();
      setMessage("Document uploaded to private storage. Staff screening is required before processing.");
    }
    setBusy(false);
  }

  async function submitApplication(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setError(""); setMessage("");
    if (!(await persistDraft({ step: 8 }))) return;
    setBusy(true);
    const data = new FormData(form);
    const response = await fetch(`/api/client/applications/${application.id}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sharingAuthorization: data.get("sharingAuthorization") === "yes",
        screeningConsent: data.get("screeningConsent") === "yes",
        termsVersion: application.termsVersion,
        termsSha256: application.termsSha256,
        formVersion: application.formVersion,
        formSha256: application.formSha256
      })
    });
    if (!response.ok) setError(await responseMessage(response));
    else { setMessage("Application submitted. Your receipt and status are now available."); router.refresh(); }
    setBusy(false);
  }

  if (!editable) {
    return <div className="client-application-flow">
      <ApplicationOverview application={application} completedCount={7} />
      <section className="client-panel submission-receipt-panel"><p className="eyebrow">Application received</p><h2>Your application has been submitted</h2><p>Keep the receipt for your records. Ting Ting will contact you if more information is required.</p><div className="submission-receipt-summary"><p><strong>Submitted:</strong> {application.submittedAt ? new Date(application.submittedAt).toLocaleString("en-CA") : "—"}</p><p><strong>Consent recorded:</strong> {application.consentedAt ? new Date(application.consentedAt).toLocaleString("en-CA") : "—"}</p><a className="button secondary" href={`/api/client/applications/${application.id}/receipt`}>Download submission receipt</a></div></section>
      <ApplicationHelp />
    </div>;
  }

  return <div className="client-application-flow">
    <ApplicationOverview application={{ ...application, files }} completedCount={completedCount} />
    <div className="application-wizard">
      <aside className="application-stepper" aria-label="Application progress">
        <p>Application steps</p>
        <ol>{steps.map((step, index) => {
          const number = index + 1;
          return <li key={step.label}><button type="button" className={number === activeStep ? "active" : undefined} aria-current={number === activeStep ? "step" : undefined} onClick={() => { setActiveStep(number); setError(""); setMessage(""); }}><span>{completed[index] ? "✓" : number}</span><span><small>Step {number}</small>{step.label}</span></button></li>;
        })}</ol>
        <div className="application-save-state"><strong>{completedCount} of 7 sections ready</strong><span>{lastSaved ? `Last saved ${new Date(lastSaved).toLocaleString("en-CA")}` : "Not saved yet"}</span></div>
      </aside>

      <section className="client-panel application-step-panel" aria-labelledby="application-step-title">
        <p className="step-number">Step {activeStep} of 8</p>
        {activeStep === 1 && <form onSubmit={continueStep}><h2 id="application-step-title">Personal details</h2><p>Use your legal name and current contact details. We do not request a SIN through this portal.</p><div className="application-form-grid">
          <Field label="Legal first name *"><input value={draft.personal.legalFirstName} onChange={(event) => updateSection("personal", { legalFirstName: event.target.value })} autoComplete="given-name" required /></Field>
          <Field label="Legal last name *"><input value={draft.personal.legalLastName} onChange={(event) => updateSection("personal", { legalLastName: event.target.value })} autoComplete="family-name" required /></Field>
          <Field label="Phone number *"><input type="tel" value={draft.personal.phone} onChange={(event) => updateSection("personal", { phone: event.target.value })} autoComplete="tel" required /></Field>
          <Field label="Alternative phone"><input type="tel" value={draft.personal.alternatePhone} onChange={(event) => updateSection("personal", { alternatePhone: event.target.value })} /></Field>
          <Field label="Email address *" wide><input type="email" value={draft.personal.email} onChange={(event) => updateSection("personal", { email: event.target.value })} autoComplete="email" required /></Field>
        </div><StepActions step={activeStep} busy={busy} onBack={() => setActiveStep(1)} onExit={() => void persistDraft({ exit: true })} /></form>}

        {activeStep === 2 && <form onSubmit={continueStep}><h2 id="application-step-title">Household and tenancy request</h2><p>Tell us what you need from this tenancy. Occupant count is collected for occupancy planning; do not include ages or protected personal characteristics.</p><div className="application-form-grid">
          <Field label="Desired move-in date *"><input type="date" value={draft.tenancy.desiredMoveInDate} onChange={(event) => updateSection("tenancy", { desiredMoveInDate: event.target.value })} required /></Field>
          <Field label="Preferred lease term *"><select value={draft.tenancy.leaseTerm} onChange={(event) => updateSection("tenancy", { leaseTerm: event.target.value })} required><option value="" disabled>Choose a term</option><option value="month_to_month">Month to month</option><option value="six_months">Six months</option><option value="one_year">One year</option><option value="other">Other</option></select></Field>
          <Field label="Total occupants *"><input type="number" min={1} max={12} value={draft.tenancy.occupantCount || ""} onChange={(event) => updateSection("tenancy", { occupantCount: Number(event.target.value) || 0 })} required /></Field>
          <Field label="Do you still need a showing? *"><select value={draft.tenancy.needsShowing} onChange={(event) => updateSection("tenancy", { needsShowing: event.target.value })} required><option value="" disabled>Choose one</option><option value="yes">Yes</option><option value="no">No</option></select></Field>
          <Field label="Housing needs" wide group><div className="application-inline-checks"><label><input type="checkbox" checked={draft.tenancy.hasPets} onChange={(event) => updateSection("tenancy", { hasPets: event.target.checked })} />I have pets</label><label><input type="checkbox" checked={draft.tenancy.needsParking} onChange={(event) => updateSection("tenancy", { needsParking: event.target.checked })} />I require parking</label></div></Field>
          {draft.tenancy.hasPets && <Field label="Pet details *" wide><input value={draft.tenancy.petDetails} onChange={(event) => updateSection("tenancy", { petDetails: event.target.value })} maxLength={300} required /></Field>}
          <Field label="Why does this home fit your needs? *" wide><textarea rows={4} maxLength={500} value={draft.tenancy.reasonForChoosing} onChange={(event) => updateSection("tenancy", { reasonForChoosing: event.target.value })} required /><small className="field-hint">{draft.tenancy.reasonForChoosing.length}/500</small></Field>
        </div><DisclosureNotice /><StepActions step={activeStep} busy={busy} onBack={() => setActiveStep(1)} onExit={() => void persistDraft({ exit: true })} /></form>}

        {activeStep === 3 && <form onSubmit={continueStep}><h2 id="application-step-title">Housing history</h2><p>Provide your current housing contact so the information can be verified with your authorization at submission.</p><div className="application-form-grid">
          <Field label="Current address *" wide><input value={draft.housing.currentAddress} onChange={(event) => updateSection("housing", { currentAddress: event.target.value })} autoComplete="street-address" required /></Field>
          <Field label="Living there since *"><input type="month" value={draft.housing.currentHousingSince} onChange={(event) => updateSection("housing", { currentHousingSince: event.target.value })} required /></Field>
          <Field label="Current monthly rent (CAD) *"><input type="number" min={0} max={100000} value={draft.housing.currentMonthlyRent || ""} onChange={(event) => updateSection("housing", { currentMonthlyRent: Number(event.target.value) || 0 })} required /></Field>
          <Field label="Landlord or housing contact *"><input value={draft.housing.landlordName} onChange={(event) => updateSection("housing", { landlordName: event.target.value })} required /></Field>
          <Field label="Contact phone *"><input type="tel" value={draft.housing.landlordPhone} onChange={(event) => updateSection("housing", { landlordPhone: event.target.value })} required /></Field>
          <Field label="Reason for leaving *" wide><textarea rows={3} maxLength={500} value={draft.housing.reasonForLeaving} onChange={(event) => updateSection("housing", { reasonForLeaving: event.target.value })} required /></Field>
        </div><StepActions step={activeStep} busy={busy} onBack={() => setActiveStep(2)} onExit={() => void persistDraft({ exit: true })} /></form>}

        {activeStep === 4 && <form onSubmit={continueStep}><h2 id="application-step-title">Employment and income</h2><p>Enter the current source that can verify your ability to meet the tenancy obligations. Do not upload bank credentials or a SIN.</p><div className="application-form-grid">
          <Field label="Employment status *"><select value={draft.employment.employmentStatus} onChange={(event) => updateSection("employment", { employmentStatus: event.target.value })} required><option value="" disabled>Choose a status</option><option value="employed">Employed</option><option value="self_employed">Self-employed</option><option value="student">Student</option><option value="retired">Retired</option><option value="other">Other</option></select></Field>
          <Field label="Employer or income source *"><input value={draft.employment.employerOrIncomeSource} onChange={(event) => updateSection("employment", { employerOrIncomeSource: event.target.value })} required /></Field>
          <Field label="Occupation or current role *"><input value={draft.employment.occupation} onChange={(event) => updateSection("employment", { occupation: event.target.value })} required /></Field>
          <Field label="In this role since *"><input type="month" value={draft.employment.employmentSince} onChange={(event) => updateSection("employment", { employmentSince: event.target.value })} required /></Field>
          <Field label="Gross monthly income (CAD) *"><input type="number" min={1} max={1000000} value={draft.employment.grossMonthlyIncome || ""} onChange={(event) => updateSection("employment", { grossMonthlyIncome: Number(event.target.value) || 0 })} required /></Field>
          <Field label="Verification contact name *"><input value={draft.employment.contactName} onChange={(event) => updateSection("employment", { contactName: event.target.value })} required /></Field>
          <Field label="Verification contact phone *"><input type="tel" value={draft.employment.contactPhone} onChange={(event) => updateSection("employment", { contactPhone: event.target.value })} required /></Field>
        </div><DisclosureNotice /><StepActions step={activeStep} busy={busy} onBack={() => setActiveStep(3)} onExit={() => void persistDraft({ exit: true })} /></form>}

        {activeStep === 5 && <form onSubmit={continueStep}><h2 id="application-step-title">References</h2><p>Provide one required personal or professional reference. A second reference is optional.</p><ReferenceFields title="Primary reference" value={draft.references.primary} required onChange={(patch) => updateSection("references", { primary: { ...draft.references.primary, ...patch } })} /><ReferenceFields title="Second reference (optional)" value={draft.references.secondary} onChange={(patch) => updateSection("references", { secondary: { ...draft.references.secondary, ...patch } })} /><StepActions step={activeStep} busy={busy} onBack={() => setActiveStep(4)} onExit={() => void persistDraft({ exit: true })} /></form>}

        {activeStep === 6 && <form onSubmit={continueStep}><h2 id="application-step-title">Emergency contact</h2><p>This contact is for tenancy-related emergencies and is not used as a rental reference.</p><div className="application-form-grid">
          <Field label="Contact name *"><input value={draft.emergency.name} onChange={(event) => updateSection("emergency", { name: event.target.value })} required /></Field>
          <Field label="Relationship *"><input value={draft.emergency.relationship} onChange={(event) => updateSection("emergency", { relationship: event.target.value })} required /></Field>
          <Field label="Phone number *"><input type="tel" value={draft.emergency.phone} onChange={(event) => updateSection("emergency", { phone: event.target.value })} required /></Field>
          <Field label="Email address"><input type="email" value={draft.emergency.email} onChange={(event) => updateSection("emergency", { email: event.target.value })} /></Field>
        </div><StepActions step={activeStep} busy={busy} onBack={() => setActiveStep(5)} onExit={() => void persistDraft({ exit: true })} /></form>}

        {activeStep === 7 && <div><h2 id="application-step-title">Supporting documents</h2><p>Upload only documents requested for this application. PDF, JPEG, or PNG; maximum 10 MB each and 8 files.</p>{files.length > 0 && <ul className="application-file-list">{files.map((file) => <li key={file.id}><span>{file.originalFilename}</span><small>{Math.ceil(file.byteSize / 1024)} KB · {file.scanStatus.replaceAll("_", " ")}</small></li>)}</ul>}<form onSubmit={uploadFile}><Field label="Choose a supporting document"><input name="file" type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" required /></Field><button className="button secondary" type="submit" disabled={busy}>{busy ? "Uploading…" : "Upload securely"}</button></form><details className="application-paper-fallback"><summary>Need the paper fallback?</summary><p>Download the assigned form only if you cannot complete the online fields. Upload the completed copy here rather than emailing it.</p><a className="text-link" href={`/api/client/applications/${application.id}/form`}>Download fallback application form</a></details><form onSubmit={continueStep}><StepActions step={activeStep} busy={busy} onBack={() => setActiveStep(6)} onExit={() => void persistDraft({ exit: true })} /></form></div>}

        {activeStep === 8 && <form onSubmit={submitApplication}><h2 id="application-step-title">Review and submit</h2><p>Review every section before giving the required authorizations. You cannot edit the application after submission.</p><div className="application-review-list">
          <ReviewGroup title="Personal details" onEdit={() => setActiveStep(1)} rows={[["Legal name", `${draft.personal.legalFirstName} ${draft.personal.legalLastName}`], ["Phone", draft.personal.phone], ["Email", draft.personal.email]]} />
          <ReviewGroup title="Household & tenancy" onEdit={() => setActiveStep(2)} rows={[["Move-in date", draft.tenancy.desiredMoveInDate], ["Lease term", draft.tenancy.leaseTerm.replaceAll("_", " ")], ["Occupants", String(draft.tenancy.occupantCount)], ["Showing required", draft.tenancy.needsShowing]]} />
          <ReviewGroup title="Housing history" onEdit={() => setActiveStep(3)} rows={[["Current address", draft.housing.currentAddress], ["Housing contact", draft.housing.landlordName], ["Current rent", `$${draft.housing.currentMonthlyRent.toLocaleString("en-CA")}`]]} />
          <ReviewGroup title="Employment & income" onEdit={() => setActiveStep(4)} rows={[["Status", draft.employment.employmentStatus.replaceAll("_", " ")], ["Employer / source", draft.employment.employerOrIncomeSource], ["Role", draft.employment.occupation], ["Gross monthly income", `$${draft.employment.grossMonthlyIncome.toLocaleString("en-CA")}`]]} />
          <ReviewGroup title="References" onEdit={() => setActiveStep(5)} rows={[["Primary reference", draft.references.primary.name], ["Relationship", draft.references.primary.relationship], ["Second reference", draft.references.secondary.name]]} />
          <ReviewGroup title="Emergency contact" onEdit={() => setActiveStep(6)} rows={[["Name", draft.emergency.name], ["Relationship", draft.emergency.relationship], ["Phone", draft.emergency.phone]]} />
          <ReviewGroup title="Documents" onEdit={() => setActiveStep(7)} rows={files.map((file, index) => [`Document ${index + 1}`, file.originalFilename])} />
        </div><div className="application-terms" tabIndex={0}>{termsText.split("\n").map((paragraph, index) => paragraph ? <p key={index}>{paragraph}</p> : null)}</div><p>Read the full <Link href="/terms/application" target="_blank">application terms</Link> and <Link href="/privacy" target="_blank">privacy notice</Link>.</p><label className="application-consent"><input name="sharingAuthorization" type="checkbox" value="yes" required /><span>I authorize the property manager to share my application information with the landlord of this unit for assessment of this application. *</span></label><label className="application-consent"><input name="screeningConsent" type="checkbox" value="yes" required /><span>I consent to the stated credit-score, reference, housing, and income-verification checks for this rental application. *</span></label><div className="application-step-actions"><button className="button secondary" type="button" onClick={() => setActiveStep(7)} disabled={busy}>Back</button><button className="text-button" type="button" onClick={() => void persistDraft({ exit: true })} disabled={busy}>Save and exit</button><button className="button" type="submit" disabled={busy || completedCount < 7}>{busy ? "Submitting…" : "Submit application"}</button></div>{completedCount < 7 && <p className="field-hint">Complete all seven sections before submitting.</p>}</form>}

        {message && <p className="form-status success" role="status" aria-live="polite">{message}</p>}
        {error && <p className="form-status error" role="alert" aria-live="assertive">{error}</p>}
      </section>
    </div>
    <ApplicationHelp />
  </div>;
}

function ApplicationOverview({ application, completedCount }: { application: ClientApplicationRecord; completedCount: number }) {
  return <section className="client-panel application-overview" aria-labelledby="application-overview"><div className="client-panel-heading"><div><p className="eyebrow">Application reference {application.id}</p><h1 id="application-overview">{application.propertyTitle}</h1><p>{application.propertyAddress}</p></div><span className={`application-status status-${application.status}`}>{statusLabel(application.status)}</span></div>{application.status === "draft" && <div className="application-progress" aria-label={`${completedCount} of 7 sections complete`}><span style={{ width: `${(completedCount / 7) * 100}%` }} /><small>{completedCount} of 7 sections ready</small></div>}{application.legalReviewStatus === "pending" && <p className="legal-review-warning" role="note">Pre-production draft: final legal, privacy, screening, and representation-disclosure approval is required before real applicant use.</p>}</section>;
}

function ReferenceFields({ title, value, required = false, onChange }: { title: string; value: ApplicationDraft["references"]["primary"]; required?: boolean; onChange: (patch: Record<string, string>) => void }) {
  return <fieldset className="application-subsection"><legend>{title}</legend><div className="application-form-grid"><Field label={`Name${required ? " *" : ""}`}><input value={value.name} onChange={(event) => onChange({ name: event.target.value })} required={required} /></Field><Field label={`Relationship${required ? " *" : ""}`}><input value={value.relationship} onChange={(event) => onChange({ relationship: event.target.value })} required={required} /></Field><Field label={`Phone${required ? " *" : ""}`}><input type="tel" value={value.phone} onChange={(event) => onChange({ phone: event.target.value })} required={required} /></Field><Field label="Email"><input type="email" value={value.email} onChange={(event) => onChange({ email: event.target.value })} /></Field></div></fieldset>;
}

function DisclosureNotice() {
  return <div className="application-disclosure-note"><strong>Representation disclosure</strong><p>Before providing housing needs or financial qualifications, review the current BCFSA <a href="https://www.bcfsa.ca/public-resources/real-estate/mandatory-disclosure" target="_blank" rel="noreferrer">Disclosure for Residential Tenancies</a>. Ting Ting’s exact role and the approved disclosure delivery process must be confirmed before production use.</p></div>;
}

function ApplicationHelp() {
  return <section className="client-panel application-help"><h2>Correction, withdrawal, or privacy request</h2><p>Email <a href={`mailto:${PUBLIC_CONTACT_EMAIL}`}>{PUBLIC_CONTACT_EMAIL}</a> with the application reference only. Do not email identity documents or application content.</p></section>;
}
