"use client";

import Link from "next/link";
import { type ChangeEvent, type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import {
  APPLICATION_DOCUMENT_LABELS,
  APPLICATION_DOCUMENT_TYPES,
  APPLICATION_REQUIRED_DOCUMENT_TYPES,
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

export function GuestApplicationEntry() {
  const [bootstrap, setBootstrap] = useState<GuestBootstrap | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    async function openGuestApplication() {
      const fragmentToken = new URLSearchParams(window.location.hash.slice(1)).get("token") ?? undefined;
      if (fragmentToken) window.history.replaceState({}, "", "/application/guest");
      setLoading(true);
      setError("");
      try {
        const response = await fetch("/api/application-guests/session", fragmentToken ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: fragmentToken }),
          signal: controller.signal
        } : { method: "GET", signal: controller.signal });

        const body = await readEnvelope<GuestBootstrap>(response);
        if (!response.ok || !body.data) {
          setError(accessError(response, body));
          return;
        }
        setBootstrap(body.data);
      } catch (caught) {
        if ((caught as Error).name !== "AbortError") {
          setError("We could not open the application. Check your connection and try again.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void openGuestApplication();
    return () => controller.abort();
  }, []);

  if (loading) return <GuestShell><div className="guest-application-state" role="status" aria-live="polite"><span className="guest-loading-mark" aria-hidden="true" /><h1>Opening your secure application…</h1><p>No account or password is required.</p></div></GuestShell>;

  if (!bootstrap) return <GuestShell><div className="guest-application-state guest-access-error" role="alert"><p className="eyebrow">Secure link unavailable</p><h1>We cannot open this invitation</h1><p>{error}</p><p>For privacy, do not email application documents. Contact <a href={`mailto:${PUBLIC_CONTACT_EMAIL}`}>{PUBLIC_CONTACT_EMAIL}</a> using only the property address and your name.</p></div></GuestShell>;

  return <GuestShell><GuestApplicationPortal initialData={bootstrap} /></GuestShell>;
}

function GuestShell({ children }: { children: ReactNode }) {
  return <main className="client-route guest-application-main">
    <header className="guest-application-header">
      <Link href="/" aria-label="Ting Ting Xu home" className="guest-wordmark">Ting Ting Xu</Link>
      <span>Secure co-applicant application</span>
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

  const documentsComplete = useMemo(() => APPLICATION_REQUIRED_DOCUMENT_TYPES.every(
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
    if (targetStep === 5 && !documentsComplete) {
      const missing = APPLICATION_REQUIRED_DOCUMENT_TYPES.find(
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
      const body = await readEnvelope<{ draftUpdatedAt?: string }>(response);
      if (!response.ok) {
        setError(accessError(response, body));
        return false;
      }
      setLastSaved(body.data?.draftUpdatedAt ?? new Date().toISOString());
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
        setMessage(`${APPLICATION_DOCUMENT_LABELS[documentType]} uploaded securely.`);
      }
    } catch {
      setError("The file could not be uploaded. Check your connection and try again.");
    } finally {
      input.value = "";
      setBusy(false);
    }
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
      <dl><div><dt>Applicant</dt><dd>{data.applicant.legalName}</dd></div><div><dt>Email</dt><dd>{data.applicant.email}</dd></div></dl>
      <p className="guest-security-note">This private link gives you access only to your own application information. No account or password is required.</p>
      <p className="field-hint">Before you begin: we collect this information to assess the tenancy application, verify supporting details, and—only with your consent—request credit screening. See our <Link className="guest-privacy-link" href="/privacy">privacy notice</Link>.</p>
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
      {step === 5 && <DocumentsStep draft={draft} files={files} busy={busy} updateExplanation={updateDocumentExplanation} upload={uploadSelectedFile} onBack={() => setStep(4)} onSubmit={continueStep} />}
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

function TenancyStep({ draft, busy, updateSection, onBack, onSubmit }: GuestStepProps) {
  return <form onSubmit={onSubmit}><h2 id="guest-step-heading">Household and tenancy request</h2><p>Confirm the tenancy request from your perspective.</p><div className="application-form-grid">
    <GuestField label="Desired move-in date *"><input type="date" value={draft.tenancy.desiredMoveInDate} onChange={(event) => updateSection("tenancy", { desiredMoveInDate: event.target.value })} required /></GuestField>
    <GuestField label="Preferred lease term *"><select value={draft.tenancy.leaseTerm} onChange={(event) => updateSection("tenancy", { leaseTerm: event.target.value })} required><option value="" disabled>Choose a term</option><option value="month_to_month">Month to month</option><option value="six_months">Six months</option><option value="one_year">One year</option><option value="other">Other</option></select></GuestField>
    <GuestField label="Adults *"><input type="number" min={1} max={12} value={draft.tenancy.adultCount ?? ""} onChange={(event) => updateSection("tenancy", { adultCount: event.target.value === "" ? null : Number(event.target.value) })} required /></GuestField>
    <GuestField label="Children *"><input type="number" min={0} max={12} value={draft.tenancy.childCount ?? ""} onChange={(event) => updateSection("tenancy", { childCount: event.target.value === "" ? null : Number(event.target.value) })} required /></GuestField>
    <GuestField label="Do you still need a showing? *"><select value={draft.tenancy.needsShowing} onChange={(event) => updateSection("tenancy", { needsShowing: event.target.value })} required><option value="" disabled>Choose one</option><option value="yes">Yes</option><option value="no">No</option></select></GuestField>
    <fieldset className="application-field-wide guest-inline-options"><legend>Housing needs</legend><label><input type="checkbox" checked={draft.tenancy.hasPets} onChange={(event) => updateSection("tenancy", { hasPets: event.target.checked })} />I have pets</label><label><input type="checkbox" checked={draft.tenancy.needsParking} onChange={(event) => updateSection("tenancy", { needsParking: event.target.checked })} />I require parking</label></fieldset>
    {draft.tenancy.hasPets && <GuestField label="Pet details *" wide><input value={draft.tenancy.petDetails} onChange={(event) => updateSection("tenancy", { petDetails: event.target.value })} maxLength={300} required /></GuestField>}
    <GuestField label="Why does this home fit your needs?" wide><textarea rows={4} maxLength={500} value={draft.tenancy.reasonForChoosing} onChange={(event) => updateSection("tenancy", { reasonForChoosing: event.target.value })} /></GuestField>
  </div><GuestActions busy={busy} onBack={onBack} /></form>;
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

function DocumentsStep({ draft, files, busy, updateExplanation, upload, onBack, onSubmit }: {
  draft: ApplicationDraft;
  files: ApplicationFileRecord[];
  busy: boolean;
  updateExplanation: (documentType: keyof ApplicationDraft["documentExplanations"], value: string) => void;
  upload: (event: ChangeEvent<HTMLInputElement>, documentType: ApplicationDocumentType) => void;
  onBack: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return <form onSubmit={onSubmit}><h2 id="guest-step-heading">Your verification documents</h2><p>Upload files that belong to you. The primary applicant cannot view your private files or screening details.</p><p className="field-hint">PDF, JPEG, or PNG; maximum 10 MB. Redact your SIN, account numbers, and login credentials.</p><div className="application-document-categories">
    {APPLICATION_DOCUMENT_TYPES.map((documentType) => {
      const categoryFiles = files.filter((file) => file.documentType === documentType);
      const requiredType = APPLICATION_REQUIRED_DOCUMENT_TYPES.find((type) => type === documentType);
      const explanation = requiredType ? draft.documentExplanations[requiredType] : "";
      const explanationId = `guest-document-explanation-${documentType}`;
      return <section className="application-document-category" key={documentType}>
        <div><strong>{APPLICATION_DOCUMENT_LABELS[documentType]}{requiredType ? " *" : ""}</strong><small>{requiredType ? "Required" : "Optional"}</small></div>
        {categoryFiles.length > 0 && <ul className="application-file-list">{categoryFiles.map((file) => <li key={file.id}><span>{file.originalFilename}</span><small>{Math.ceil(file.byteSize / 1024)} KB · {file.scanStatus.replaceAll("_", " ")}</small></li>)}</ul>}
        <label className={`application-file-picker${busy ? " is-disabled" : ""}`}>
          <input aria-label={`Choose ${APPLICATION_DOCUMENT_LABELS[documentType]} file`} type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onChange={(event) => void upload(event, documentType)} disabled={busy} />
          <span className="application-file-picker-icon" aria-hidden="true">↑</span><span><strong>{categoryFiles.length ? "Upload another file" : "Choose file to upload"}</strong><small>The file uploads after you select it.</small></span>
        </label>
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
    <label className="application-consent"><input name="screeningConsent" type="checkbox" value="yes" required /><span>I consent to the stated credit-score, reference, housing, and income-verification checks for my rental application. *</span></label>
    <GuestField label="Type your full legal name to sign *" wide hint={`Enter your legal name as shown above: ${data.applicant.legalName}`}><input name="signatureLegalName" autoComplete="name" maxLength={160} required /></GuestField>
    <p className="guest-signature-notice">By selecting “Sign my application,” you confirm this typed name is your electronic signature and that the information you provided is accurate.</p>
    <div className="application-step-actions"><button className="button secondary" type="button" disabled={busy} onClick={onBack}>Back</button><button className="button" type="submit" disabled={busy}>{busy ? "Recording signature…" : "Sign my application"}</button></div>
  </form>;
}

function ReviewCard({ title, rows, onEdit }: { title: string; rows: string[][]; onEdit: () => void }) {
  return <section className="application-review-group"><div><h3>{title}</h3><button className="text-button" type="button" onClick={onEdit}>Edit</button></div><dl>{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || "—"}</dd></div>)}</dl></section>;
}
