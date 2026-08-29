"use client";

import { type FormEvent, useState } from "react";
import type { ApplicationApplicantRecord } from "@/features/applications/contracts";

export type CoApplicantStatus = "invited" | "in_progress" | "signed" | "expired" | "revoked";

export type CoApplicantSummary = Pick<ApplicationApplicantRecord, "id" | "legalName" | "email" | "status" | "signedAt">;

const statusCopy: Record<CoApplicantStatus, { label: string; description: string }> = {
  invited: {
    label: "Invitation sent",
    description: "Waiting for this applicant to open their secure invitation."
  },
  in_progress: {
    label: "In progress",
    description: "This applicant has opened the invitation and is completing their information."
  },
  signed: {
    label: "Signed",
    description: "This applicant has completed and signed their part of the application."
  },
  expired: {
    label: "Invitation expired",
    description: "Send a new invitation so this applicant can continue."
  },
  revoked: {
    label: "Access revoked",
    description: "This applicant no longer has access to the application."
  }
};

interface CoApplicantPanelProps {
  applicants: CoApplicantSummary[];
  busyApplicantId?: string | null;
  inviting?: boolean;
  onInvite: (input: { legalName: string; email: string }) => Promise<boolean>;
  onResend: (applicantId: string) => Promise<void>;
  onRevoke: (applicantId: string) => Promise<void>;
  onRefresh: () => void;
}

export function activeCoApplicantsSigned(applicants: CoApplicantSummary[]) {
  return applicants
    .filter((applicant) => applicant.status !== "revoked")
    .every((applicant) => applicant.status === "signed");
}

export function CoApplicantPanel({
  applicants,
  busyApplicantId = null,
  inviting = false,
  onInvite,
  onResend,
  onRevoke,
  onRefresh
}: CoApplicantPanelProps) {
  const [legalName, setLegalName] = useState("");
  const [email, setEmail] = useState("");
  const [showInviteForm, setShowInviteForm] = useState(false);

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const invited = await onInvite({ legalName: legalName.trim(), email: email.trim() });
    if (!invited) return;
    setLegalName("");
    setEmail("");
    setShowInviteForm(false);
  }

  const activeApplicants = applicants.filter((applicant) => applicant.status !== "revoked");
  const signedCount = activeApplicants.filter((applicant) => applicant.status === "signed").length;

  return <section className="co-applicant-panel" aria-labelledby="co-applicant-heading">
    <div className="co-applicant-heading">
      <div>
        <p className="eyebrow">Joint application</p>
        <h2 id="co-applicant-heading">Other adult applicants</h2>
        <p>Invite each adult who needs to be screened. They can complete and sign their part securely without creating an account.</p>
      </div>
      <div className="co-applicant-heading-actions">
        <button className="text-button" type="button" onClick={onRefresh}>Refresh status</button>
        <button
          className="button secondary"
          type="button"
          aria-expanded={showInviteForm}
          aria-controls="co-applicant-invite-form"
          onClick={() => setShowInviteForm((current) => !current)}
        >
          {showInviteForm ? "Cancel" : "Add co-applicant"}
        </button>
      </div>
    </div>

    {showInviteForm && <form id="co-applicant-invite-form" className="co-applicant-invite-form" onSubmit={invite}>
      <div className="application-form-grid">
        <label className="field" htmlFor="co-applicant-legal-name">
          <span>Legal name <span aria-hidden="true">*</span></span>
          <input
            id="co-applicant-legal-name"
            value={legalName}
            onChange={(event) => setLegalName(event.target.value)}
            autoComplete="name"
            maxLength={160}
            required
            aria-required="true"
          />
        </label>
        <label className="field" htmlFor="co-applicant-email">
          <span>Email address <span aria-hidden="true">*</span></span>
          <input
            id="co-applicant-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            maxLength={254}
            required
            aria-required="true"
          />
        </label>
      </div>
      <p className="field-hint">We will email a time-limited secure link. The co-applicant will not need a password or account.</p>
      <button className="button" type="submit" disabled={inviting}>
        {inviting ? "Sending invitation…" : "Send secure invitation"}
      </button>
    </form>}

    {applicants.length === 0
      ? <p className="co-applicant-empty">No co-applicants have been invited.</p>
      : <ul className="co-applicant-list">
        {applicants.map((applicant) => {
          const copy = statusCopy[applicant.status];
          const busy = busyApplicantId === applicant.id;
          const canResend = applicant.status === "invited" || applicant.status === "expired";
          const canRevoke = applicant.status !== "signed" && applicant.status !== "revoked";
          return <li key={applicant.id}>
            <div className="co-applicant-identity">
              <strong>{applicant.legalName}</strong>
              <span>{applicant.email}</span>
            </div>
            <div className="co-applicant-state">
              <span className={`co-applicant-status status-${applicant.status}`}>{copy.label}</span>
              <small>{copy.description}</small>
              {applicant.signedAt && <small>Signed {new Date(applicant.signedAt).toLocaleString("en-CA")}</small>}
            </div>
            {(canResend || canRevoke) && <div className="co-applicant-actions">
              {canResend && <button className="text-button" type="button" disabled={busy} onClick={() => void onResend(applicant.id)}>
                {busy ? "Working…" : applicant.status === "expired" ? "Send new invitation" : "Resend invitation"}
              </button>}
              {canRevoke && <button className="text-button danger" type="button" disabled={busy} onClick={() => void onRevoke(applicant.id)}>
                Revoke access
              </button>}
            </div>}
          </li>;
        })}
      </ul>}

    {activeApplicants.length > 0 && <p className="co-applicant-progress" role="status" aria-live="polite">
      <strong>{signedCount} of {activeApplicants.length} co-applicants signed.</strong>{" "}
      {signedCount < activeApplicants.length && "You can finish your own application now, but final submission stays locked until everyone signs."}
    </p>}
  </section>;
}
