"use client";

import Link from "next/link";
import { CheckCircle2, FileText, UserRoundCheck, X } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  APPLICATION_DOCUMENT_LABELS,
  type ApplicationStatus,
  type ApplicationStatusUpdateResult,
  type ClientApplicationRecord
} from "@/features/applications/contracts";

function applicantName(application: ClientApplicationRecord) {
  return [application.draft.personal.legalFirstName, application.draft.personal.legalLastName]
    .filter(Boolean).join(" ").trim() || "Applicant";
}

function leaseAddress(address: string) {
  const unit = address.match(/^unit\s+([^,]+),\s*(.+)$/i);
  if (unit) return { unitLabel: unit[1].trim(), propertyLabel: unit[2].trim() };
  const dash = address.match(/^([^–—]+)\s*[–—]\s*(.+)$/);
  if (dash) return { unitLabel: dash[1].trim(), propertyLabel: dash[2].trim() };
  return { unitLabel: "", propertyLabel: address };
}

function readableError(body: unknown, fallback: string) {
  if (body && typeof body === "object" && "error" in body) {
    const error = (body as { error?: { message?: unknown } }).error;
    if (typeof error?.message === "string") return error.message;
  }
  return fallback;
}

type ApplicationQueueFilter = "open" | ApplicationStatus | "decided" | "rejected" | "contract_signed";

export function ApplicationQueue({ initial, initialFilter = "open" }: { initial: ClientApplicationRecord[]; initialFilter?: ApplicationQueueFilter }) {
  const [applications, setApplications] = useState(initial);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ApplicationQueueFilter>(initialFilter);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showTenantForm, setShowTenantForm] = useState(false);
  const [tenantLeaseType, setTenantLeaseType] = useState<"month_to_month" | "fixed_term" | "">("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const selected = useMemo(
    () => applications.find((application) => application.id === selectedId) ?? null,
    [applications, selectedId]
  );
  const visibleApplications = useMemo(() => {
    const term = query.trim().toLowerCase();
    return applications.filter((application) => {
      const decided = ["approved", "declined", "withdrawn"].includes(application.status);
      const inFilter = filter === "open"
        ? !decided && application.status !== "draft"
        : filter === "rejected"
          ? application.status === "declined"
          : filter === "contract_signed"
            ? application.status === "approved" && Boolean(application.leaseDocument)
        : filter === "decided"
          ? decided
          : application.status === filter;
      if (!inFilter) return false;
      if (!term) return true;
      return [application.id, applicantName(application), application.propertyTitle, application.propertyAddress]
        .some((value) => value.toLowerCase().includes(term));
    });
  }, [applications, filter, query]);

  const filterCount = (value: typeof filter) => applications.filter((application) => {
    const decided = ["approved", "declined", "withdrawn"].includes(application.status);
    if (value === "open") return !decided && application.status !== "draft";
    if (value === "rejected") return application.status === "declined";
    if (value === "contract_signed") return application.status === "approved" && Boolean(application.leaseDocument);
    if (value === "decided") return decided;
    return application.status === value;
  }).length;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (selected && !dialog.open) dialog.showModal();
    if (!selected && dialog.open) dialog.close();
  }, [selected]);

  function openReview(application: ClientApplicationRecord, trigger: HTMLButtonElement) {
    triggerRef.current = trigger;
    setError("");
    setNotice("");
    setShowTenantForm(false);
    setSelectedId(application.id);
  }

  function closeReview() {
    dialogRef.current?.close();
  }

  async function changeStatus(applicationId: string, status: ApplicationStatus) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/admin/applications/${applicationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status })
      });
      const body = await response.json();
      if (!response.ok || !body.success) {
        throw new Error(readableError(body, "The application status could not be updated."));
      }
      const updated = body.data as ApplicationStatusUpdateResult;
      setApplications((current) => current.map((item) => item.id === applicationId ? updated : item));
      if (status === "approved") {
        if (["queued", "sent"].includes(updated.applicantNotification.status)) {
          setNotice("Application approved. The applicant approval email was queued successfully.");
        } else if (updated.applicantNotification.status === "disabled") {
          setError("Application approved, but applicant email delivery is disabled. Contact the applicant manually.");
        } else {
          setError("Application approved, but the approval email could not be sent. Contact the applicant manually.");
        }
      } else {
        setNotice(`Application moved to ${status.replaceAll("_", " ")}.`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The application status could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  async function reviewFile(applicationId: string, fileId: string, decision: "cleared" | "rejected") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/admin/application-files/${fileId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision })
      });
      const body = await response.json();
      if (!response.ok || !body.success) {
        throw new Error(readableError(body, "The file screening decision could not be recorded."));
      }
      setApplications((current) => current.map((application) => application.id !== applicationId ? application : {
        ...application,
        files: application.files.map((file) => file.id === fileId ? { ...file, scanStatus: decision } : file)
      }));
      setNotice(decision === "cleared" ? "Document marked as cleared." : "Document rejected.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The file screening decision could not be recorded.");
    } finally {
      setBusy(false);
    }
  }

  async function createTenant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/admin/applications/${selected.id}/tenant`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyLabel: form.get("propertyLabel"),
          unitLabel: String(form.get("unitLabel") ?? "").trim() || null,
          moveInDate: form.get("moveInDate"),
          leaseType: form.get("leaseType"),
          leaseEndDate: String(form.get("leaseEndDate") ?? "").trim() || null,
          rentDueDay: Number(form.get("rentDueDay"))
        })
      });
      const body = await response.json();
      if (!response.ok || !body.success) {
        throw new Error(readableError(body, "The tenant record could not be created."));
      }
      const updated = body.data.application as ClientApplicationRecord;
      setApplications((current) => current.map((item) => item.id === selected.id ? updated : item));
      setShowTenantForm(false);
      setNotice("Tenant created and linked to this Client account.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The tenant record could not be created.");
    } finally {
      setBusy(false);
    }
  }

  async function uploadLease(applicationId: string, file: File) {
    setBusy(true);
    setError("");
    setNotice("Uploading the signed tenancy agreement securely…");
    try {
      const data = new FormData();
      data.set("file", file);
      const response = await fetch(`/api/admin/applications/${applicationId}/lease`, {
        method: "POST",
        body: data
      });
      const body = await response.json();
      if (!response.ok || !body.success) {
        throw new Error(readableError(body, "The signed tenancy agreement could not be uploaded."));
      }
      setApplications((current) => current.map((application) => application.id === applicationId
        ? { ...application, leaseDocument: body.data }
        : application));
      setNotice("Signed tenancy agreement uploaded to private storage.");
    } catch (cause) {
      setNotice("");
      setError(cause instanceof Error ? cause.message : "The signed tenancy agreement could not be uploaded.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="prototype-page application-queue-page">
      <div className="application-queue-toolbar">
        <div>
          <strong>{filterCount("open")} open applications</strong>
          <span>{filterCount("submitted")} waiting to be received · {applications.filter((application) => application.files.some((file) => file.scanStatus !== "cleared")).length} with unscreened files</span>
        </div>
        <label className="application-queue-search">
          <span className="sr-only">Search applications</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} type="search" placeholder="Search reference, applicant, property" />
        </label>
      </div>
      <div className="application-filter-pills" aria-label="Filter applications">
        {([
          ["open", "All open"],
          ["under_review", "Under review"],
          ["approved", "Approved"],
          ["rejected", "Rejected"],
          ["contract_signed", "Contract signed"]
        ] as const).map(([value, label]) => <button key={value} type="button" className={filter === value ? "active" : undefined} onClick={() => setFilter(value)}>{label} · {filterCount(value)}</button>)}
      </div>
      <p className="legal-review-warning">
        Applicant records are need-to-know data. Download documents only for approved screening,
        record the decision here, and never copy private files into email or public links.
      </p>
      <div className="table-scroll" tabIndex={0}>
        <table className="admin-table application-queue-table">
          <thead><tr><th>Applicant</th><th>Property</th><th>Status</th><th>Submitted</th><th>Documents</th><th>Action</th></tr></thead>
          <tbody>{visibleApplications.map((application) => {
            const filesCleared = application.files.length > 0 && application.files.every((file) => file.scanStatus === "cleared");
            return (
              <tr key={application.id}>
                <td><strong>{applicantName(application)}</strong><small>{application.id}</small></td>
                <td><strong>{application.propertyTitle}</strong><small>{application.propertyAddress}</small></td>
                <td><span className={`application-status application-status-${application.status}`}>{application.status.replaceAll("_", " ")}</span></td>
                <td>{application.submittedAt ? new Date(application.submittedAt).toLocaleString("en-CA") : "Not submitted"}</td>
                <td><span className={filesCleared ? "document-state cleared" : "document-state pending"}>{application.files.length} files<br />{filesCleared ? "Cleared" : "Screening required"}</span></td>
                <td>
                  <button className="application-review-button" type="button" onClick={(event) => openReview(application, event.currentTarget)}>
                    <FileText size={17} aria-hidden /> Review application
                  </button>
                </td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
      {visibleApplications.length === 0 && <p className="prototype-empty-row">No applications match this view.</p>}

      <dialog
        ref={dialogRef}
        className="application-review-dialog"
        aria-labelledby="application-review-title"
        onCancel={() => setSelectedId(null)}
        onClose={() => {
          setSelectedId(null);
          setShowTenantForm(false);
          triggerRef.current?.focus();
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeReview();
        }}
      >
        {selected && (
          <div className="application-review-dialog-panel">
            <header className="application-review-header">
              <div>
                <span className="eyebrow">RENTAL APPLICATION</span>
                <h2 id="application-review-title">{applicantName(selected)}</h2>
                <p>{selected.propertyTitle} · {selected.propertyAddress}</p>
              </div>
              <button className="dialog-close" type="button" aria-label="Close application review" onClick={closeReview}><X aria-hidden /></button>
            </header>

            <div className="application-review-summary">
              <span className={`application-status application-status-${selected.status}`}>{selected.status.replaceAll("_", " ")}</span>
              <span>Reference {selected.id}</span>
              <span>{selected.submittedAt ? `Submitted ${new Date(selected.submittedAt).toLocaleString("en-CA")}` : "Not submitted"}</span>
            </div>

            <div className="application-review-content">
              <ApplicationDetails application={selected} />
              <ApplicationFiles application={selected} busy={busy} onReview={reviewFile} />

              {selected.status === "approved" && !selected.convertedTenantId && showTenantForm && (
                <TenantConversionForm
                  application={selected}
                  busy={busy}
                  leaseType={tenantLeaseType}
                  setLeaseType={setTenantLeaseType}
                  onUploadLease={uploadLease}
                  onSubmit={createTenant}
                  onCancel={() => setShowTenantForm(false)}
                />
              )}

              {notice && <p className="form-status success" role="status">{notice}</p>}
              {error && <p className="form-status error" role="alert">{error}</p>}
            </div>

            <footer className="application-review-actions">
              <button className="admin-action secondary" type="button" onClick={closeReview}>Close</button>
              {selected.status === "submitted" && (
                <button className="admin-action primary" disabled={busy} type="button" onClick={() => changeStatus(selected.id, "received")}>Mark received</button>
              )}
              {selected.status === "received" && <>
                <button className="admin-action secondary" disabled={busy} type="button" onClick={() => changeStatus(selected.id, "needs_information")}>Request information</button>
                <button className="admin-action primary" disabled={busy || selected.files.some((file) => file.scanStatus !== "cleared")} type="button" onClick={() => changeStatus(selected.id, "under_review")}>Start review</button>
              </>}
              {selected.status === "needs_information" && (
                <button className="admin-action primary" disabled={busy} type="button" onClick={() => changeStatus(selected.id, "received")}>Information received</button>
              )}
              {selected.status === "under_review" && <>
                <button className="admin-action secondary" disabled={busy} type="button" onClick={() => changeStatus(selected.id, "needs_information")}>Request information</button>
                <button className="admin-action danger" disabled={busy} type="button" onClick={() => changeStatus(selected.id, "declined")}><X size={17} aria-hidden /> Decline</button>
                <button className="admin-action success" disabled={busy} type="button" onClick={() => changeStatus(selected.id, "approved")}><CheckCircle2 size={17} aria-hidden /> Approve &amp; email client</button>
              </>}
              {selected.status === "approved" && !selected.convertedTenantId && !showTenantForm && (
                <button className="admin-action success" disabled={busy} type="button" onClick={() => {
                  const term = selected.draft.tenancy.leaseTerm;
                  setTenantLeaseType(term === "month_to_month" ? "month_to_month" : ["six_months", "one_year"].includes(term) ? "fixed_term" : "");
                  setShowTenantForm(true);
                }}><UserRoundCheck size={17} aria-hidden /> Mark as tenant</button>
              )}
              {selected.convertedTenantId && (
                <Link className="admin-action success" href={`/admin/tenants/${selected.convertedTenantId}`}><UserRoundCheck size={17} aria-hidden /> Manage tenant</Link>
              )}
            </footer>
          </div>
        )}
      </dialog>
    </div>
  );
}

function ApplicationDetails({ application }: { application: ClientApplicationRecord }) {
  const { draft } = application;
  return <div className="application-detail-grid">
    <DetailCard title="Applicant">
      <Detail label="Legal name" value={applicantName(application)} />
      <Detail label="Email" value={draft.personal.email} href={`mailto:${draft.personal.email}`} />
      <Detail label="Phone" value={draft.personal.phone} href={`tel:${draft.personal.phone}`} />
      <Detail label="Alternate phone" value={draft.personal.alternatePhone} />
    </DetailCard>
    <DetailCard title="Requested tenancy">
      <Detail label="Move-in" value={draft.tenancy.desiredMoveInDate} />
      <Detail label="Lease term" value={draft.tenancy.leaseTerm.replaceAll("_", " ")} />
      <Detail label="Occupants" value={String(draft.tenancy.occupantCount || "—")} />
      <Detail label="Pets / parking" value={`${draft.tenancy.hasPets ? `Pets: ${draft.tenancy.petDetails || "yes"}` : "No pets"} · ${draft.tenancy.needsParking ? "Parking required" : "No parking"}`} />
      <Detail label="Property fit" value={draft.tenancy.reasonForChoosing} wide />
    </DetailCard>
    <DetailCard title="Current housing">
      <Detail label="Address" value={draft.housing.currentAddress} wide />
      <Detail label="Since" value={draft.housing.currentHousingSince} />
      <Detail label="Monthly rent" value={`$${draft.housing.currentMonthlyRent.toLocaleString("en-CA")}`} />
      <Detail label="Landlord / contact" value={`${draft.housing.landlordName || "—"} · ${draft.housing.landlordPhone || "—"}`} wide />
      <Detail label="Reason for leaving" value={draft.housing.reasonForLeaving} wide />
    </DetailCard>
    <DetailCard title="Employment & income">
      <Detail label="Status" value={draft.employment.employmentStatus.replaceAll("_", " ")} />
      <Detail label="Role" value={draft.employment.occupation} />
      <Detail label="Employer / source" value={draft.employment.employerOrIncomeSource} />
      <Detail label="Gross monthly income" value={`$${draft.employment.grossMonthlyIncome.toLocaleString("en-CA")}`} />
      <Detail label="Since" value={draft.employment.employmentSince} />
      <Detail label="Verification contact" value={`${draft.employment.contactName || "—"} · ${draft.employment.contactPhone || "—"}`} />
    </DetailCard>
    <DetailCard title="References">
      <Detail label="Primary" value={`${draft.references.primary.name || "—"} · ${draft.references.primary.relationship || "—"} · ${draft.references.primary.phone || "—"} ${draft.references.primary.email ? `· ${draft.references.primary.email}` : ""}`} wide />
      <Detail label="Secondary" value={draft.references.secondary.name ? `${draft.references.secondary.name} · ${draft.references.secondary.relationship || "—"} · ${draft.references.secondary.phone || "—"} ${draft.references.secondary.email ? `· ${draft.references.secondary.email}` : ""}` : "Not provided"} wide />
    </DetailCard>
    <DetailCard title="Emergency contact">
      <Detail label="Contact" value={`${draft.emergency.name || "—"} · ${draft.emergency.relationship || "—"}`} />
      <Detail label="Phone / email" value={`${draft.emergency.phone || "—"}${draft.emergency.email ? ` · ${draft.emergency.email}` : ""}`} />
    </DetailCard>
  </div>;
}

function DetailCard({ title, children }: { title: string; children: ReactNode }) {
  return <section className="application-detail-card"><h3>{title}</h3><dl>{children}</dl></section>;
}

function Detail({ label, value, href, wide = false }: { label: string; value: string; href?: string; wide?: boolean }) {
  return <div className={wide ? "wide" : undefined}><dt>{label}</dt><dd>{href && value ? <a href={href}>{value}</a> : value || "—"}</dd></div>;
}

function ApplicationFiles({ application, busy, onReview }: {
  application: ClientApplicationRecord;
  busy: boolean;
  onReview: (applicationId: string, fileId: string, decision: "cleared" | "rejected") => Promise<void>;
}) {
  return <section className="application-documents-panel">
    <div><h3>Private income and credit score documents</h3><p>Download only to the approved screening workstation.</p></div>
    <ul>{application.files.map((file) => (
      <li key={file.id}>
        <FileText aria-hidden />
        <span><strong>{file.originalFilename}</strong><small>{APPLICATION_DOCUMENT_LABELS[file.documentType]} · {Math.ceil(file.byteSize / 1024)} KB · {file.scanStatus.replaceAll("_", " ")}</small></span>
        {file.scanStatus !== "rejected" && <a className="admin-action secondary compact" href={`/api/admin/application-files/${file.id}`}>Secure download</a>}
        {["manual_review_required", "screening_pending"].includes(file.scanStatus) && <>
          <button className="admin-action success compact" disabled={busy} type="button" onClick={() => onReview(application.id, file.id, "cleared")}>Mark cleared</button>
          <button className="admin-action danger compact" disabled={busy} type="button" onClick={() => onReview(application.id, file.id, "rejected")}>Reject file</button>
        </>}
      </li>
    ))}</ul>
  </section>;
}

function TenantConversionForm({ application, busy, leaseType, setLeaseType, onUploadLease, onSubmit, onCancel }: {
  application: ClientApplicationRecord;
  busy: boolean;
  leaseType: "month_to_month" | "fixed_term" | "";
  setLeaseType: (value: "month_to_month" | "fixed_term" | "") => void;
  onUploadLease: (applicationId: string, file: File) => Promise<void>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onCancel: () => void;
}) {
  const address = leaseAddress(application.propertyAddress);
  return <form className="tenant-conversion-form" onSubmit={onSubmit}>
    <div className="tenant-conversion-heading"><div><span className="eyebrow">SIGNED CONTRACT</span><h3>Create the tenant record</h3></div><button className="text-button" type="button" onClick={onCancel}>Cancel</button></div>
    <p>Use the signed tenancy agreement—not the original application—to confirm these final lease details.</p>
    <div className={`lease-upload-control ${application.leaseDocument ? "complete" : ""}`}>
      <div>
        <span className="application-group-label">Signed tenancy agreement PDF *</span>
        {application.leaseDocument ? <>
          <strong>{application.leaseDocument.originalFilename}</strong>
          <small>{Math.ceil(application.leaseDocument.byteSize / 1024)} KB · stored privately</small>
          <a className="text-link" href={`/api/admin/application-leases/${application.leaseDocument.id}`}>Secure download</a>
        </> : <small>Required before this Client can be marked as a tenant. PDF only, maximum 20 MB.</small>}
      </div>
      <label className="lease-upload-button">
        <FileText size={17} aria-hidden />
        <span>{application.leaseDocument ? "Replace contract" : "Choose signed contract"}</span>
        <input
          aria-label="Choose signed tenancy agreement PDF"
          type="file"
          accept="application/pdf,.pdf"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void onUploadLease(application.id, file);
            event.target.value = "";
          }}
        />
      </label>
    </div>
    <div className="field-grid">
      <label className="field"><span>Property</span><input name="propertyLabel" required defaultValue={address.propertyLabel} /></label>
      <label className="field"><span>Unit</span><input name="unitLabel" defaultValue={address.unitLabel} /></label>
      <label className="field"><span>Lease start date</span><input name="moveInDate" type="date" required defaultValue={application.draft.tenancy.desiredMoveInDate} /></label>
      <label className="field"><span>Lease type</span><select name="leaseType" required value={leaseType} onChange={(event) => setLeaseType(event.target.value as typeof leaseType)}><option value="">Choose from contract</option><option value="month_to_month">Month to month</option><option value="fixed_term">Fixed term</option></select></label>
      {leaseType === "fixed_term" && <label className="field"><span>Lease end date</span><input name="leaseEndDate" type="date" required min={application.draft.tenancy.desiredMoveInDate || undefined} /></label>}
      <label className="field"><span>Rent due day</span><input name="rentDueDay" type="number" min={1} max={31} required defaultValue={1} /></label>
      <label className="check-field field-wide"><input type="checkbox" required />I confirm the tenancy agreement has been signed and these details match the contract.</label>
    </div>
    <button className="admin-action success" disabled={busy || !application.leaseDocument} type="submit"><UserRoundCheck size={17} aria-hidden /> {busy ? "Working…" : "Create & link tenant"}</button>
  </form>;
}
