"use client";

import { useState } from "react";
import type { ApplicationStatus, ClientApplicationRecord } from "@/features/applications/contracts";

const nextActions: Partial<Record<ApplicationStatus, Array<{ status: ApplicationStatus; label: string }>>> = {
  submitted: [{ status: "received", label: "Mark received" }],
  received: [
    { status: "under_review", label: "Start review" },
    { status: "needs_information", label: "Needs information" }
  ],
  needs_information: [{ status: "received", label: "Information received" }],
  under_review: [
    { status: "approved", label: "Approve" },
    { status: "declined", label: "Decline" },
    { status: "needs_information", label: "Needs information" }
  ]
};

export function ApplicationQueue({ initial }: { initial: ClientApplicationRecord[] }) {
  const [applications, setApplications] = useState(initial);
  const [error, setError] = useState("");

  async function changeStatus(applicationId: string, status: ApplicationStatus) {
    setError("");
    const response = await fetch(`/api/admin/applications/${applicationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status })
    });
    if (!response.ok) {
      setError("Status could not be updated. Confirm every file is screened, then reload and try again.");
      return;
    }
    setApplications((current) => current.map((item) => item.id === applicationId ? { ...item, status } : item));
  }

  async function reviewFile(applicationId: string, fileId: string, decision: "cleared" | "rejected") {
    setError("");
    const response = await fetch(`/api/admin/application-files/${fileId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision })
    });
    if (!response.ok) {
      setError("The file screening decision could not be recorded. Recent MFA authentication may be required.");
      return;
    }
    setApplications((current) => current.map((application) => application.id !== applicationId ? application : {
      ...application,
      files: application.files.map((file) => file.id === fileId ? { ...file, scanStatus: decision } : file)
    }));
  }

  return (
    <div className="prototype-page">
      <p className="legal-review-warning">
        Applicant records are need-to-know data. Download only to the approved screening workstation,
        record the screening result, and never copy files into email or public links. Final legal/privacy
        approval is required before production.
      </p>
      <div className="table-scroll">
        <table className="admin-table">
          <thead><tr><th>Property / reference</th><th>Status</th><th>Online application</th><th>Private files</th><th>Submitted</th><th>Next action</th></tr></thead>
          <tbody>{applications.map((application) => {
            const filesCleared = application.files.length > 0 && application.files.every((file) => file.scanStatus === "cleared");
            const actions = (nextActions[application.status] ?? []).filter((action) =>
              action.status !== "under_review" || filesCleared
            );
            return (
              <tr key={application.id}>
                <td><strong>{application.propertyTitle}</strong><br /><small>{application.id}</small></td>
                <td>{application.status.replaceAll("_", " ")}</td>
                <td><ApplicationDraftReview application={application} /></td>
                <td>
                  <details className="application-file-review">
                    <summary>{application.files.length} · {filesCleared ? "cleared" : "screening required"}</summary>
                    <ul>{application.files.map((file) => (
                      <li key={file.id}>
                        <span>{file.originalFilename}<small>{file.scanStatus.replaceAll("_", " ")}</small></span>
                        <a className="text-link" href={`/api/admin/application-files/${file.id}`}>Download for secure scan</a>
                        {["manual_review_required", "screening_pending"].includes(file.scanStatus) && (
                          <span className="table-actions">
                            <button className="text-button" type="button" onClick={() => reviewFile(application.id, file.id, "cleared")}>Mark cleared</button>
                            <button className="text-button danger" type="button" onClick={() => reviewFile(application.id, file.id, "rejected")}>Reject file</button>
                          </span>
                        )}
                      </li>
                    ))}</ul>
                  </details>
                </td>
                <td>{application.submittedAt ? new Date(application.submittedAt).toLocaleString("en-CA") : "Not submitted"}</td>
                <td><div className="table-actions">{actions.map((action) => (
                  <button className="text-button" type="button" key={action.status} onClick={() => changeStatus(application.id, action.status)}>{action.label}</button>
                ))}</div></td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
      {applications.length === 0 && <p className="prototype-empty-row">No client applications have been assigned.</p>}
      {error && <p className="form-status error" role="alert">{error}</p>}
    </div>
  );
}

function ApplicationDraftReview({ application }: { application: ClientApplicationRecord }) {
  const draft = application.draft;
  const applicant = `${draft.personal.legalFirstName} ${draft.personal.legalLastName}`.trim();
  return <details className="application-draft-review"><summary>{applicant || "Draft not started"}</summary><dl>
    <div><dt>Contact</dt><dd>{draft.personal.phone || "—"}<br />{draft.personal.email || "—"}</dd></div>
    <div><dt>Tenancy</dt><dd>{draft.tenancy.desiredMoveInDate || "—"} · {draft.tenancy.occupantCount || "—"} occupants<br />{draft.tenancy.leaseTerm.replaceAll("_", " ") || "—"}</dd></div>
    <div><dt>Housing</dt><dd>{draft.housing.currentAddress || "—"}<br />Contact: {draft.housing.landlordName || "—"} · {draft.housing.landlordPhone || "—"}</dd></div>
    <div><dt>Employment</dt><dd>{draft.employment.employerOrIncomeSource || "—"}<br />{draft.employment.occupation || "—"} · ${draft.employment.grossMonthlyIncome.toLocaleString("en-CA")}/month</dd></div>
    <div><dt>Reference</dt><dd>{draft.references.primary.name || "—"} · {draft.references.primary.relationship || "—"}<br />{draft.references.primary.phone || "—"}</dd></div>
    <div><dt>Emergency</dt><dd>{draft.emergency.name || "—"} · {draft.emergency.relationship || "—"}<br />{draft.emergency.phone || "—"}</dd></div>
  </dl></details>;
}
