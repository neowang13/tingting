"use client";

import Link from "next/link";
import { CreditReportConsent } from "@/components/client/credit-report-consent";
import { ApplicationFileList } from "@/components/client/application-file-list";
import { type ChangeEvent, type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import {
  APPLICATION_DOCUMENT_LABELS,
  APPLICATION_DOCUMENT_TYPES,
  CO_APPLICANT_REQUIRED_DOCUMENT_TYPES,
  applicationDocumentRequirementSatisfied,
  type ApplicationDocumentType,
  type ApplicationFileRecord
} from "@/features/applications/contracts";
import {
  applicationDraftStepIssues,
  type ApplicationDraft,
  type ApplicationDraftSection
} from "@/features/applications/schemas";
import { PUBLIC_CONTACT_EMAIL } from "@/lib/site-contact";

type GuestApplicantStatus = "invited" | "in_progress" | "signed" | "expired" | "revoked";

interface GuestBootstrap {
  application: {
    id: string;
    propertyTitle: string;
    propertyAddress: string;
    formVersion: string;
    formSha256: string;
    termsVersion: string;
    termsSha256: string;
    termsText: string;
  };
  applicant: {
    id: string;
    legalName: string;
    email: string;
    status: GuestApplicantStatus;
    draft: ApplicationDraft;
    draftUpdatedAt: string | null;
    files: ApplicationFileRecord[];
    signedAt: string | null;
  };
}

interface ApiEnvelope<T> {
  data?: T;
  error?: { code?: string; message?: string };
}

async function readEnvelope<T>(response: Response) {
  try {
    return await response.json() as ApiEnvelope<T>;
  } catch {
    return {} as ApiEnvelope<T>;
  }
}

function accessError(response: Response, body: ApiEnvelope<unknown>) {
  if (response.status === 410) return "This invitation has expired or was revoked. Ask the primary applicant to send a new invitation.";
  if (response.status === 401 || response.status === 403) return "This secure invitation is invalid or no longer available.";
  return body.error?.message || "We could not open this secure application. Try the invitation link again.";
}

export function GuestApplicationEntry({ signedIn = false }: { signedIn?: boolean }) {
  const [bootstrap, setBootstrap] = useState<GuestBootstrap | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [invitation, setInvitation] = useState<{ token?: string; invitationId?: string } | null>(null);
  const [nextPath, setNextPath] = useState("/client/invitations");

  async function openApplication(input?: { token?: string; invitationId?: string; applicantId?: string }) {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/application-guests/session", input ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) } : { method: "GET", cache: "no-store" });
      const body = await readEnvelope<GuestBootstrap>(response);
      if (!response.ok || !body.data) { setError(accessError(response, body)); return; }
      sessionStorage.removeItem("silverkey-pending-invitation");
      setBootstrap(body.data); setInvitation(null);
    } catch { setError("We could not open the application. Check your connection and try again."); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    async function restoreInvitation() {
    const params = await Promise.resolve(new URLSearchParams(window.location.search));
    const invitationId = params.get("invitation");
    const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
    const applicantId = params.get("applicant");
    if (token) sessionStorage.setItem("silverkey-pending-invitation", token);
    const path = `/client/invitations${invitationId ? `?invitation=${encodeURIComponent(invitationId)}` : applicantId ? `?applicant=${encodeURIComponent(applicantId)}` : ""}`;
    window.history.replaceState({}, "", path); setNextPath(path);
    const pendingToken = token ?? sessionStorage.getItem("silverkey-pending-invitation");
    if (invitationId || pendingToken) { setInvitation(invitationId ? { invitationId } : { token: pendingToken! }); setLoading(false); }
    else if (!signedIn) setLoading(false);
    else void openApplication(applicantId ? { applicantId } : undefined);
    }
    void restoreInvitation();
  }, [signedIn]);

  if (!signedIn) return <GuestShell><section className="client-panel"><p className="eyebrow">Joint application invitation</p><h1>Use your own User account</h1><p>Sign in or register with the email address this invitation was sent to, then verify your email. Your documents and confirmations belong to your account.</p><Link className="button" href={`/client/login?next=${encodeURIComponent(nextPath)}`}>Sign in to accept</Link>{" "}<Link className="button secondary" href={`/client/signup?next=${encodeURIComponent(nextPath)}`}>Create my account</Link></section></GuestShell>;
  if (loading) return <GuestShell><div className="guest-application-state" role="status"><h1>Opening your application…</h1></div></GuestShell>;
  if (invitation && !bootstrap) return <GuestShell><section className="client-panel"><p className="eyebrow">Joint application invitation</p><h1>Accept your invitation</h1><p>Your verified account must match the invited email address. You will fill in and sign only your own information.</p>{error && <p role="alert" className="form-status error">{error}</p>}<button className="button" onClick={() => void openApplication(invitation)}>Accept invitation</button>{" "}<Link href="/client/applications">My applications</Link></section></GuestShell>;
  if (!bootstrap) return <GuestShell><div className="guest-application-state" role="alert"><h1>We cannot open this application</h1><p>{error}</p><Link href="/client/applications">Return to my applications</Link><p>Contact <a href={`mailto:${PUBLIC_CONTACT_EMAIL}`}>{PUBLIC_CONTACT_EMAIL}</a> using only the property and application reference.</p></div></GuestShell>;
  return <GuestShell><GuestApplicationPortal initialData={bootstrap} /></GuestShell>;
}

function GuestShell({ children }: { children: ReactNode }) {
  return <main className="client-route guest-application-main">
    <header className="guest-application-header">
      <Link href="/" aria-label="Ting Ting Xu home" className="guest-wordmark">Ting Ting Xu</Link>
      <span>Joint application</span><Link href="/client/applications">My applications</Link>
    </header>
    {children}
  </main>;
}

const guestSteps: ReadonlyArray<{ label: string; sections?: ApplicationDraftSection[] }> = [
  { label: "Personal", sections: ["personal"] },
  { label: "Tenancy", sections: ["tenancy"] },
  { label: "Housing & income", sections: ["housing", "employment"] },
  { label: "Contacts", sections: ["references", "emergency"] },
  { label: "Documents" },
  { label: "Review & sign" }
];

function GuestApplicationPortal({ initialData }: { initialData: GuestBootstrap }) {
  const [data, setData] = useState(initialData);
  const [draft, setDraft] = useState(initialData.applicant.draft);
  const [files, setFiles] = useState(initialData.applicant.files);
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [lastSaved, setLastSaved] = useState(initialData.applicant.draftUpdatedAt);

  const documentsComplete = useMemo(() => CO_APPLICANT_REQUIRED_DOCUMENT_TYPES.every(
    (documentType) => applicationDocumentRequirementSatisfied(documentType, files, draft.documentExplanations)
  ), [draft.documentExplanations, files]);

  function updateSection(section: ApplicationDraftSection, patch: Record<string, unknown>) {
    setDraft((current) => ({ ...current, [section]: { ...current[section], ...patch } } as ApplicationDraft));
    setMessage("");
  }

  function updateDocumentExplanation(documentType: keyof ApplicationDraft["documentExplanations"], value: string) {
    setDraft((current) => ({ ...current, documentExplanations: { ...current.documentExplanations, [documentType]: value } }));
    setMessage("");
  }

  function validateStep(targetStep: number) {
    const sections = guestSteps[targetStep - 1]?.sections ?? [];
    for (const section of sections) {
      const issue = applicationDraftStepIssues(draft, section)[0];
      if (issue) return issue;
    }
    if (targetStep === 5 && files.some(file => file.documentType === "credit_score_report") && !draft.creditReportVoluntary) return "Confirm that you voluntarily provide your credit score report before continuing.";
    if (targetStep === 5 && !documentsComplete) {
      const missing = CO_APPLICANT_REQUIRED_DOCUMENT_TYPES.find(
        (documentType) => !applicationDocumentRequirementSatisfied(documentType, files, draft.documentExplanations)
      );
      return `Upload ${APPLICATION_DOCUMENT_LABELS[missing!].toLowerCase()} or provide an explanation of at least 10 characters.`;
    }
    return "";
  }

  async function persistDraft(targetStep = step) {
    setError("");
    setMessage("");
    setBusy(true);
    try {
      const response = await fetch("/api/application-guests/draft", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft, activeStep: targetStep })
      });
      const body = await readEnvelope<{ draftUpdatedAt?: string; draft?: ApplicationDraft }>(response);
      if (!response.ok) {
        setError(accessError(response, body));
        return false;
      }
      setLastSaved(body.data?.draftUpdatedAt ?? new Date().toISOString());
      if (body.data?.draft && JSON.stringify(body.data.draft.tenancy) !== JSON.stringify(draft.tenancy)) {
        setDraft(body.data.draft);
        setStep(2);
        setError("The primary applicant updated the shared tenancy. Review the current household and tenancy details before continuing or signing.");
        return false;
      }
      setMessage("Your application draft was saved securely.");
      return true;
    } catch {
      setError("Your draft could not be saved. Check your connection and try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function continueStep(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const issue = validateStep(step);
    if (issue) {
      setError(issue);
      return;
    }
    if (await persistDraft(step)) {
      setStep((current) => Math.min(6, current + 1));
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  async function uploadSelectedFile(event: ChangeEvent<HTMLInputElement>, documentType: ApplicationDocumentType) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.set("file", file);
    formData.set("documentType", documentType);
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/application-guests/files", { method: "POST", body: formData });
      const body = await readEnvelope<ApplicationFileRecord>(response);
      if (!response.ok || !body.data) {
        setError(accessError(response, body));
      } else {
        setFiles((current) => [...current, body.data!]);
        if (documentType === "credit_score_report") setDraft(current => ({ ...current, creditReportVoluntary: false }));
        setMessage(`${APPLICATION_DOCUMENT_LABELS[documentType]} uploaded securely.`);
      }
    } catch {
      setError("The file could not be uploaded. Check your connection and try again.");
    } finally {
      input.value = "";
      setBusy(false);
    }
  }

  async function removeFile(file: ApplicationFileRecord) {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/application-guests/files/${file.id}`, { method: "DELETE" });
      const body = await readEnvelope<{ removed: boolean }>(response);
      if (!response.ok || !body.data) { setError(accessError(response, body)); return; }
      setFiles(current => current.filter(item => item.id !== file.id));
      setMessage(`${file.originalFilename} removed from your application.`);
    } catch {
      setError("The file could not be removed. Check your connection and try again.");
    } finally { setBusy(false); }
  }

  async function sign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setError("");
    setMessage("");
    const issue = guestSteps.slice(0, 4).flatMap((item) => item.sections ?? [])
      .map((section) => applicationDraftStepIssues(draft, section)[0])
      .find(Boolean);
    if (issue || !documentsComplete) {
      setError(issue || "Complete the required document step before signing.");
      return;
    }
    if (!(await persistDraft(6))) return;
    const formData = new FormData(form);
    setBusy(true);
    try {
      const response = await fetch("/api/application-guests/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signatureLegalName: formData.get("signatureLegalName"),
          sharingAuthorization: formData.get("sharingAuthorization") === "yes",
          screeningConsent: formData.get("screeningConsent") === "yes",
          termsVersion: data.application.termsVersion,
          termsSha256: data.application.termsSha256,
          formVersion: data.application.formVersion,
          formSha256: data.application.formSha256
        })
      });
      const body = await readEnvelope<{ applicant: GuestBootstrap["applicant"] }>(response);
      if (!response.ok || !body.data?.applicant) {
        setError(accessError(response, body));
      } else {
        setData((current) => ({ ...current, applicant: body.data!.applicant }));
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    } catch {
      setError("Your signature could not be recorded. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (data.applicant.status === "signed") {
    return <section className="guest-confirmation client-panel" aria-labelledby="guest-confirmation-title">
      <div className="guest-confirmation-mark" aria-hidden="true">✓</div>
      <p className="eyebrow">Signature recorded</p>
      <h1 id="guest-confirmation-title">Your part of the application is complete</h1>
      <p>Thank you, {data.applicant.legalName}. The primary applicant can now see that you have signed, but cannot see your private screening details.</p>
      <dl>
        <div><dt>Property</dt><dd>{data.application.propertyTitle}</dd></div>
        <div><dt>Address</dt><dd>{data.application.propertyAddress}</dd></div>
        <div><dt>Signed</dt><dd>{data.applicant.signedAt ? new Date(data.applicant.signedAt).toLocaleString("en-CA") : "Recorded"}</dd></div>
      </dl>
      <p className="field-hint">You may close this window. No account was created.</p>
    </section>;
  }

  if (data.applicant.status === "expired" || data.applicant.status === "revoked") {
    return <div className="guest-application-state guest-access-error" role="alert"><p className="eyebrow">Access unavailable</p><h1>This invitation is no longer active</h1><p>Ask the primary applicant to send a new secure invitation.</p></div>;
  }

  return <div className="guest-application-layout">
    <section className="guest-property-summary client-panel" aria-labelledby="guest-property-heading">
      <p className="eyebrow">Invited co-applicant</p>
      <h1 id="guest-property-heading">{data.application.propertyTitle}</h1>
      <p>{data.application.propertyAddress}</p>
      <dl><div><dt>Applicant</dt><dd>{`${draft.personal.legalFirstName} ${draft.personal.legalLastName}`.trim() || data.applicant.legalName}</dd></div><div><dt>Email</dt><dd>{data.applicant.email}</dd></div></dl>
      <p className="guest-security-note">Your verified account gives you access only to your own application information.</p>
      <p className="field-hint">Before you begin: we collect this information to assess the tenancy application and verify supporting details with your consent. We do not request credit checks from credit agencies. See our <Link className="guest-privacy-link" href="/privacy">privacy notice</Link>.</p>
    </section>

    <nav className="guest-stepper" aria-label="Application progress">
      <ol>{guestSteps.map((item, index) => <li key={item.label} className={step === index + 1 ? "active" : undefined}>
        <button type="button" aria-current={step === index + 1 ? "step" : undefined} onClick={() => { setStep(index + 1); setError(""); setMessage(""); }}>
          <span>{index + 1}</span>{item.label}
        </button>
      </li>)}</ol>
      <small>{lastSaved ? `Last saved ${new Date(lastSaved).toLocaleString("en-CA")}` : "Not saved yet"}</small>
    </nav>

    <section className="guest-form-panel client-panel" aria-labelledby="guest-step-heading">
      <p className="step-number">Step {step} of 6</p>
      {step === 1 && <PersonalStep draft={draft} busy={busy} updateSection={updateSection} onSubmit={continueStep} />}
      {step === 2 && <TenancyStep draft={draft} busy={busy} updateSection={updateSection} onBack={() => setStep(1)} onSubmit={continueStep} />}
      {step === 3 && <HousingIncomeStep draft={draft} busy={busy} updateSection={updateSection} onBack={() => setStep(2)} onSubmit={continueStep} />}
      {step === 4 && <ContactsStep draft={draft} busy={busy} updateSection={updateSection} onBack={() => setStep(3)} onSubmit={continueStep} />}
      {step === 5 && <DocumentsStep updateCreditConsent={value => setDraft(current => ({ ...current, creditReportVoluntary: value }))} draft={draft} files={files} busy={busy} updateExplanation={updateDocumentExplanation} upload={uploadSelectedFile} remove={removeFile} onBack={() => setStep(4)} onSubmit={continueStep} />}
      {step === 6 && <ReviewSignStep data={data} draft={draft} files={files} busy={busy} onBack={() => setStep(5)} onEdit={setStep} onSubmit={sign} />}
      {message && <p className="form-status success" role="status" aria-live="polite">{message}</p>}
      {error && <p className="form-status error" role="alert" aria-live="assertive">{error}</p>}
    </section>
  </div>;
}

function GuestField({ label, children, wide = false, hint }: { label: string; children: ReactNode; wide?: boolean; hint?: string }) {
  return <label className={`field${wide ? " application-field-wide" : ""}`}><span>{label}</span>{children}{hint && <small className="field-hint">{hint}</small>}</label>;
}

function GuestActions({ busy, first = false, onBack }: { busy: boolean; first?: boolean; onBack?: () => void }) {
  return <div className="application-step-actions">
    {!first && <button className="button secondary" type="button" disabled={busy} onClick={onBack}>Back</button>}
    <button className="button" type="submit" disabled={busy}>{busy ? "Saving…" : "Save and continue"}</button>
  </div>;
}

type GuestStepProps = {
  draft: ApplicationDraft;
  busy: boolean;
  updateSection: (section: ApplicationDraftSection, patch: Record<string, unknown>) => void;
  onBack?: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

function PersonalStep({ draft, busy, updateSection, onSubmit }: GuestStepProps) {
  return <form onSubmit={onSubmit}><h2 id="guest-step-heading">Your personal details</h2><p>Use your legal name and contact details. Do not enter a SIN.</p><div className="application-form-grid">
    <GuestField label="Legal first name *"><input value={draft.personal.legalFirstName} onChange={(event) => updateSection("personal", { legalFirstName: event.target.value })} autoComplete="given-name" required /></GuestField>
    <GuestField label="Legal last name *"><input value={draft.personal.legalLastName} onChange={(event) => updateSection("personal", { legalLastName: event.target.value })} autoComplete="family-name" required /></GuestField>
    <GuestField label="Phone number *"><input type="tel" value={draft.personal.phone} onChange={(event) => updateSection("personal", { phone: event.target.value })} autoComplete="tel" required /></GuestField>
    <GuestField label="Alternative phone"><input type="tel" value={draft.personal.alternatePhone} onChange={(event) => updateSection("personal", { alternatePhone: event.target.value })} /></GuestField>
    <GuestField label="Email address *" wide><input type="email" value={draft.personal.email} onChange={(event) => updateSection("personal", { email: event.target.value })} autoComplete="email" required /></GuestField>
  </div><GuestActions busy={busy} first /></form>;
}

function TenancyStep({ draft, busy, onBack, onSubmit }: GuestStepProps) {
  return <form onSubmit={onSubmit}><h2 id="guest-step-heading">Shared household and tenancy</h2><p>These details apply to everyone in this application and are maintained by the primary applicant. The occupant total is counted once.</p><dl className="application-review-group"><dt>Move-in</dt><dd>{draft.tenancy.desiredMoveInDate || "Not set by primary applicant"}</dd><dt>Lease term</dt><dd>{draft.tenancy.leaseTerm.replaceAll("_", " ") || "Not set"}</dd><dt>Adults / children</dt><dd>{draft.tenancy.adultCount ?? "—"} / {draft.tenancy.childCount ?? "—"}</dd><dt>Total occupants</dt><dd>{draft.tenancy.occupantCount}</dd></dl><GuestActions busy={busy} onBack={onBack} /></form>;
}

function HousingIncomeStep({ draft, busy, updateSection, onBack, onSubmit }: GuestStepProps) {
  return <form onSubmit={onSubmit}><h2 id="guest-step-heading">Housing and income</h2><p>Provide contacts that can verify the information in your application.</p><fieldset className="application-subsection"><legend>Current housing</legend><div className="application-form-grid">
    <GuestField label="Current address *" wide><input value={draft.housing.currentAddress} onChange={(event) => updateSection("housing", { currentAddress: event.target.value })} autoComplete="street-address" required /></GuestField>
    <GuestField label="Living there since *"><input type="month" value={draft.housing.currentHousingSince} onChange={(event) => updateSection("housing", { currentHousingSince: event.target.value })} required /></GuestField>
    <GuestField label="Current monthly rent (CAD) *"><input type="number" min={0} max={100000} value={draft.housing.currentMonthlyRent || ""} onChange={(event) => updateSection("housing", { currentMonthlyRent: Number(event.target.value) || 0 })} required /></GuestField>
    <GuestField label="Landlord or housing contact *"><input value={draft.housing.landlordName} onChange={(event) => updateSection("housing", { landlordName: event.target.value })} required /></GuestField>
    <GuestField label="Contact phone *"><input type="tel" value={draft.housing.landlordPhone} onChange={(event) => updateSection("housing", { landlordPhone: event.target.value })} required /></GuestField>
    <GuestField label="Reason for leaving *" wide><textarea rows={3} maxLength={500} value={draft.housing.reasonForLeaving} onChange={(event) => updateSection("housing", { reasonForLeaving: event.target.value })} required /></GuestField>
  </div></fieldset><fieldset className="application-subsection"><legend>Employment and income</legend><div className="application-form-grid">
    <GuestField label="Employment status *"><select value={draft.employment.employmentStatus} onChange={(event) => updateSection("employment", { employmentStatus: event.target.value })} required><option value="" disabled>Choose a status</option><option value="employed">Employed</option><option value="self_employed">Self-employed</option><option value="student">Student</option><option value="retired">Retired</option><option value="other">Other</option></select></GuestField>
    <GuestField label="Employer or income source *"><input value={draft.employment.employerOrIncomeSource} onChange={(event) => updateSection("employment", { employerOrIncomeSource: event.target.value })} required /></GuestField>
    <GuestField label="Occupation or current role *"><input value={draft.employment.occupation} onChange={(event) => updateSection("employment", { occupation: event.target.value })} required /></GuestField>
    <GuestField label="In this role since *"><input type="month" value={draft.employment.employmentSince} onChange={(event) => updateSection("employment", { employmentSince: event.target.value })} required /></GuestField>
    <GuestField label="Gross monthly income (CAD) *"><input type="number" min={1} max={1000000} value={draft.employment.grossMonthlyIncome || ""} onChange={(event) => updateSection("employment", { grossMonthlyIncome: Number(event.target.value) || 0 })} required /></GuestField>
    <GuestField label="Verification contact name *"><input value={draft.employment.contactName} onChange={(event) => updateSection("employment", { contactName: event.target.value })} required /></GuestField>
    <GuestField label="Verification contact phone *"><input type="tel" value={draft.employment.contactPhone} onChange={(event) => updateSection("employment", { contactPhone: event.target.value })} required /></GuestField>
  </div></fieldset><GuestActions busy={busy} onBack={onBack} /></form>;
}

function ContactsStep({ draft, busy, updateSection, onBack, onSubmit }: GuestStepProps) {
  function referenceFields(key: "primary" | "secondary", title: string, required: boolean) {
    const value = draft.references[key];
    const patch = (field: string, fieldValue: string) => updateSection("references", { [key]: { ...value, [field]: fieldValue } });
    return <fieldset className="application-subsection"><legend>{title}</legend><div className="application-form-grid">
      <GuestField label={`Name${required ? " *" : ""}`}><input value={value.name} onChange={(event) => patch("name", event.target.value)} required={required} /></GuestField>
      <GuestField label={`Relationship${required ? " *" : ""}`}><input value={value.relationship} onChange={(event) => patch("relationship", event.target.value)} required={required} /></GuestField>
      <GuestField label={`Phone${required ? " *" : ""}`}><input type="tel" value={value.phone} onChange={(event) => patch("phone", event.target.value)} required={required} /></GuestField>
      <GuestField label="Email"><input type="email" value={value.email} onChange={(event) => patch("email", event.target.value)} /></GuestField>
    </div></fieldset>;
  }
  return <form onSubmit={onSubmit}><h2 id="guest-step-heading">References and emergency contact</h2><p>These contacts are used only for the purposes described in the application notice.</p>{referenceFields("primary", "Primary reference", true)}{referenceFields("secondary", "Second reference (optional)", false)}<fieldset className="application-subsection"><legend>Emergency contact</legend><div className="application-form-grid">
    <GuestField label="Contact name *"><input value={draft.emergency.name} onChange={(event) => updateSection("emergency", { name: event.target.value })} required /></GuestField>
    <GuestField label="Relationship *"><input value={draft.emergency.relationship} onChange={(event) => updateSection("emergency", { relationship: event.target.value })} required /></GuestField>
    <GuestField label="Phone number *"><input type="tel" value={draft.emergency.phone} onChange={(event) => updateSection("emergency", { phone: event.target.value })} required /></GuestField>
    <GuestField label="Email address"><input type="email" value={draft.emergency.email} onChange={(event) => updateSection("emergency", { email: event.target.value })} /></GuestField>
  </div></fieldset><GuestActions busy={busy} onBack={onBack} /></form>;
}

function DocumentsStep({ draft, files, busy, updateExplanation, updateCreditConsent, upload, remove, onBack, onSubmit }: {
  draft: ApplicationDraft;
  files: ApplicationFileRecord[];
  busy: boolean;
  updateCreditConsent: (value: boolean) => void;
  updateExplanation: (documentType: keyof ApplicationDraft["documentExplanations"], value: string) => void;
  upload: (event: ChangeEvent<HTMLInputElement>, documentType: ApplicationDocumentType) => void;
  remove: (file: ApplicationFileRecord) => Promise<void>;
  onBack: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return <form onSubmit={onSubmit}><h2 id="guest-step-heading">Your verification documents</h2><p>Only the credit score report category is required; upload your report or explain why you cannot provide it. All other documents are optional. The primary applicant cannot view your private files or screening details.</p><p className="field-hint">PDF, JPEG, or PNG; maximum 10 MB. You can remove or replace files before signing. Redact your SIN, account numbers, and login credentials.</p><div className="application-document-categories">
    {APPLICATION_DOCUMENT_TYPES.map((documentType) => {
      const categoryFiles = files.filter((file) => file.documentType === documentType);
      const requiredType = CO_APPLICANT_REQUIRED_DOCUMENT_TYPES.find((type) => type === documentType);
      const explanation = requiredType ? draft.documentExplanations[requiredType] : "";
      const explanationId = `guest-document-explanation-${documentType}`;
      return <section className="application-document-category" key={documentType}>
        <div><strong>{APPLICATION_DOCUMENT_LABELS[documentType]}{requiredType ? " *" : ""}</strong><small>{requiredType ? "Required" : "Optional"}</small></div>
        <ApplicationFileList files={categoryFiles} busy={busy} remove={remove} />
        <label className={`application-file-picker${busy ? " is-disabled" : ""}`}>
          <input aria-label={`Choose ${APPLICATION_DOCUMENT_LABELS[documentType]} file`} type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onChange={(event) => void upload(event, documentType)} disabled={busy} />
          <span className="application-file-picker-icon" aria-hidden="true">↑</span><span><strong>{categoryFiles.length ? "Upload another file" : "Choose file to upload"}</strong><small>The file uploads after you select it.</small></span>
        </label>
        {documentType === "credit_score_report" && <CreditReportConsent checked={draft.creditReportVoluntary} disabled={busy} hasReport={categoryFiles.length > 0} onChange={updateCreditConsent} />}
        {requiredType && <div className="application-document-explanation"><span className="application-document-or" aria-hidden="true">or</span><label htmlFor={explanationId}>Explain why you cannot provide {APPLICATION_DOCUMENT_LABELS[documentType]}</label><textarea id={explanationId} rows={3} minLength={10} maxLength={500} value={explanation} onChange={(event) => updateExplanation(requiredType, event.target.value)} /><small className="field-hint">10–500 characters. An explanation may not be sufficient to verify your application.</small></div>}
      </section>;
    })}
  </div><GuestActions busy={busy} onBack={onBack} /></form>;
}

function ReviewSignStep({ data, draft, files, busy, onBack, onEdit, onSubmit }: {
  data: GuestBootstrap;
  draft: ApplicationDraft;
  files: ApplicationFileRecord[];
  busy: boolean;
  onBack: () => void;
  onEdit: (step: number) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return <form onSubmit={onSubmit}><h2 id="guest-step-heading">Review and sign</h2><p>Confirm that your information is accurate, then give your own authorizations and electronic signature. Signing does not submit on behalf of anyone else.</p><div className="guest-review-summary">
    <ReviewCard title="Personal" onEdit={() => onEdit(1)} rows={[["Legal name", `${draft.personal.legalFirstName} ${draft.personal.legalLastName}`], ["Phone", draft.personal.phone], ["Email", draft.personal.email]]} />
    <ReviewCard title="Tenancy" onEdit={() => onEdit(2)} rows={[["Move-in", draft.tenancy.desiredMoveInDate], ["Lease term", draft.tenancy.leaseTerm.replaceAll("_", " ")], ["Adults", String(draft.tenancy.adultCount ?? "—")], ["Children", String(draft.tenancy.childCount ?? "—")]]} />
    <ReviewCard title="Housing and income" onEdit={() => onEdit(3)} rows={[["Current address", draft.housing.currentAddress], ["Income source", draft.employment.employerOrIncomeSource], ["Gross monthly income", `$${draft.employment.grossMonthlyIncome.toLocaleString("en-CA")}`]]} />
    <ReviewCard title="Contacts" onEdit={() => onEdit(4)} rows={[["Primary reference", draft.references.primary.name], ["Emergency contact", draft.emergency.name]]} />
    <ReviewCard title="Documents" onEdit={() => onEdit(5)} rows={files.length ? files.map((file) => [APPLICATION_DOCUMENT_LABELS[file.documentType], file.originalFilename]) : [["Files", "Explanations provided"]]} />
  </div><div className="application-terms" tabIndex={0} aria-label="Application collection and consent notice">{data.application.termsText.split("\n").map((paragraph, index) => paragraph ? <p key={index}>{paragraph}</p> : null)}</div><p>Read the <Link href="/terms/application" target="_blank">application terms</Link> and <Link href="/privacy" target="_blank">privacy notice</Link>.</p>
    <label className="application-consent"><input name="sharingAuthorization" type="checkbox" value="yes" required /><span>I authorize the property manager to share my application information with the landlord of this unit to assess this application. *</span></label>
    <label className="application-consent"><input name="screeningConsent" type="checkbox" value="yes" required /><span>I consent to reference, housing and income verification, and review of the documents I provide for my rental application. *</span></label>
    <GuestField label="Type your full legal name to sign *" wide hint={`Enter your legal name as shown above: ${`${draft.personal.legalFirstName} ${draft.personal.legalLastName}`.trim()}`}><input name="signatureLegalName" autoComplete="name" maxLength={160} required /></GuestField>
    <p className="guest-signature-notice">By selecting “Sign my application,” you confirm this typed name is your electronic signature and that the information you provided is accurate.</p>
    <div className="application-step-actions"><button className="button secondary" type="button" disabled={busy} onClick={onBack}>Back</button><button className="button" type="submit" disabled={busy}>{busy ? "Recording signature…" : "Sign my application"}</button></div>
  </form>;
}

function ReviewCard({ title, rows, onEdit }: { title: string; rows: string[][]; onEdit: () => void }) {
  return <section className="application-review-group"><div><h3>{title}</h3><button className="text-button" type="button" onClick={onEdit}>Edit</button></div><dl>{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || "—"}</dd></div>)}</dl></section>;
}
