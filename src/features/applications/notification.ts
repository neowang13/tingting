import {
  APPLICATION_DOCUMENT_LABELS,
  type ApplicationFileRecord,
  type ClientApplicationRecord
} from "@/features/applications/contracts";
import type { ApplicationDraft } from "@/features/applications/schemas";

export const APPLICATION_EMAIL_MAX_RAW_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export interface ApplicationNotificationApplicant {
  id: string;
  role: "primary";
  email: string;
  legalName: string;
  status: "signed";
  signedAt: string | null;
  draft: ApplicationDraft;
  files: ApplicationFileRecord[];
}

export interface ApplicationSubmissionNotificationData {
  application: ClientApplicationRecord;
  applicants: ApplicationNotificationApplicant[];
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function display(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function humanize(value: string) {
  return value ? value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase()) : "—";
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0
  }).format(value);
}

function formatDateTime(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "—";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.DEFAULT_TIMEZONE ?? "America/Vancouver",
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function applicantDisplayName(applicant: ApplicationNotificationApplicant) {
  const draftName = [applicant.draft.personal.legalFirstName, applicant.draft.personal.legalLastName]
    .filter(Boolean).join(" ").trim();
  return draftName || applicant.legalName || "Applicant";
}

function detailRows(rows: Array<[string, string | number | null | undefined]>) {
  return rows.map(([label, value]) => `<tr>
    <td style="border-bottom:1px solid #ECE9E3;color:#6B6F6D;font-size:12px;font-weight:700;padding:9px 14px 9px 0;vertical-align:top;width:34%">${escapeHtml(label)}</td>
    <td style="border-bottom:1px solid #ECE9E3;color:#1F2321;font-size:14px;line-height:1.45;padding:9px 0;vertical-align:top">${escapeHtml(display(value)).replaceAll("\n", "<br>")}</td>
  </tr>`).join("");
}

function card(title: string, rows: Array<[string, string | number | null | undefined]>) {
  return `<section style="background:#FFFFFF;border:1px solid #E4E0DA;border-radius:12px;margin:0 0 14px;padding:18px 20px">
    <h3 style="color:#1C2B28;font-size:16px;margin:0 0 8px">${escapeHtml(title)}</h3>
    <table role="presentation" style="border-collapse:collapse;width:100%">${detailRows(rows)}</table>
  </section>`;
}

function applicantCards(applicant: ApplicationNotificationApplicant, index: number) {
  const draft = applicant.draft;
  const totalOccupants = draft.tenancy.occupantCount;
  const references = [draft.references.primary, draft.references.secondary]
    .filter((reference) => Object.values(reference).some(Boolean))
    .map((reference, referenceIndex) => `${referenceIndex + 1}. ${display(reference.name)} · ${display(reference.relationship)} · ${display(reference.phone)}${reference.email ? ` · ${reference.email}` : ""}`)
    .join("\n") || "—";
  const role = index === 0 ? "Primary applicant" : `Applicant ${index + 1}`;

  return `<div style="margin-top:22px">
    <div style="border-left:4px solid #2F6F5E;padding:2px 0 2px 12px;margin:0 0 12px">
      <div style="color:#2F6F5E;font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase">${escapeHtml(role)}</div>
      <h2 style="color:#1F2321;font-size:21px;margin:3px 0 0">${escapeHtml(applicantDisplayName(applicant))}</h2>
    </div>
    ${card("Applicant & signature", [
      ["Legal name", applicantDisplayName(applicant)],
      ["Email", draft.personal.email || applicant.email],
      ["Phone", draft.personal.phone],
      ["Alternate phone", draft.personal.alternatePhone],
      ["Signature status", humanize(applicant.status)],
      ["Signed", formatDateTime(applicant.signedAt)]
    ])}
    ${card("Requested tenancy", [
      ["Desired move-in", draft.tenancy.desiredMoveInDate],
      ["Lease term", humanize(draft.tenancy.leaseTerm)],
      ["Total occupants", totalOccupants],
      ["Needs showing", humanize(draft.tenancy.needsShowing)],
      ["Pets", draft.tenancy.hasPets ? draft.tenancy.petDetails || "Yes" : "No"],
      ["Parking", draft.tenancy.needsParking ? "Required" : "Not required"],
      ["Why this property", draft.tenancy.reasonForChoosing]
    ])}
    ${card("Current housing", [
      ["Current address", draft.housing.currentAddress],
      ["Living there since", draft.housing.currentHousingSince],
      ["Current monthly rent", formatMoney(draft.housing.currentMonthlyRent)],
      ["Landlord / housing contact", draft.housing.landlordName],
      ["Landlord phone", draft.housing.landlordPhone],
      ["Reason for leaving", draft.housing.reasonForLeaving]
    ])}
    ${card("Employment & income", [
      ["Employment status", humanize(draft.employment.employmentStatus)],
      ["Employer / income source", draft.employment.employerOrIncomeSource],
      ["Occupation / role", draft.employment.occupation],
      ["Since", draft.employment.employmentSince],
      ["Gross monthly income", formatMoney(draft.employment.grossMonthlyIncome)],
      ["Verification contact", draft.employment.contactName],
      ["Verification phone", draft.employment.contactPhone]
    ])}
    ${card("References & emergency contact", [
      ["References", references],
      ["Emergency contact", `${display(draft.emergency.name)} · ${display(draft.emergency.relationship)}`],
      ["Emergency phone / email", `${display(draft.emergency.phone)}${draft.emergency.email ? ` · ${draft.emergency.email}` : ""}`]
    ])}
  </div>`;
}

function textApplicant(applicant: ApplicationNotificationApplicant, index: number) {
  const draft = applicant.draft;
  const totalOccupants = draft.tenancy.occupantCount;
  const role = index === 0 ? "PRIMARY APPLICANT" : `APPLICANT ${index + 1}`;
  const rows: Array<[string, string | number | null | undefined]> = [
    ["Legal name", applicantDisplayName(applicant)], ["Email", draft.personal.email || applicant.email],
    ["Phone", draft.personal.phone], ["Alternate phone", draft.personal.alternatePhone],
    ["Signed", formatDateTime(applicant.signedAt)], ["Desired move-in", draft.tenancy.desiredMoveInDate],
    ["Lease term", humanize(draft.tenancy.leaseTerm)], ["Total occupants", totalOccupants],
    ["Needs showing", humanize(draft.tenancy.needsShowing)],
    ["Pets", draft.tenancy.hasPets ? draft.tenancy.petDetails || "Yes" : "No"],
    ["Parking", draft.tenancy.needsParking ? "Required" : "Not required"],
    ["Why this property", draft.tenancy.reasonForChoosing], ["Current address", draft.housing.currentAddress],
    ["Living there since", draft.housing.currentHousingSince], ["Current monthly rent", formatMoney(draft.housing.currentMonthlyRent)],
    ["Landlord / housing contact", draft.housing.landlordName], ["Landlord phone", draft.housing.landlordPhone],
    ["Reason for leaving", draft.housing.reasonForLeaving], ["Employment status", humanize(draft.employment.employmentStatus)],
    ["Employer / income source", draft.employment.employerOrIncomeSource], ["Occupation / role", draft.employment.occupation],
    ["Employment since", draft.employment.employmentSince], ["Gross monthly income", formatMoney(draft.employment.grossMonthlyIncome)],
    ["Verification contact", draft.employment.contactName], ["Verification phone", draft.employment.contactPhone],
    ["Primary reference", `${display(draft.references.primary.name)} · ${display(draft.references.primary.relationship)} · ${display(draft.references.primary.phone)}${draft.references.primary.email ? ` · ${draft.references.primary.email}` : ""}`],
    ["Secondary reference", draft.references.secondary.name ? `${draft.references.secondary.name} · ${display(draft.references.secondary.relationship)} · ${display(draft.references.secondary.phone)}${draft.references.secondary.email ? ` · ${draft.references.secondary.email}` : ""}` : "Not provided"],
    ["Emergency contact", `${display(draft.emergency.name)} · ${display(draft.emergency.relationship)} · ${display(draft.emergency.phone)}${draft.emergency.email ? ` · ${draft.emergency.email}` : ""}`]
  ];
  return [role, ...rows.map(([label, value]) => `${label}: ${display(value)}`)].join("\n");
}

export function groupApplicationFilesForEmail(files: ApplicationFileRecord[]) {
  const groups: ApplicationFileRecord[][] = [];
  let current: ApplicationFileRecord[] = [];
  let currentBytes = 0;
  for (const file of files) {
    if (current.length > 0 && currentBytes + file.byteSize > APPLICATION_EMAIL_MAX_RAW_ATTACHMENT_BYTES) {
      groups.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(file);
    currentBytes += file.byteSize;
  }
  if (current.length > 0 || groups.length === 0) groups.push(current);
  return groups;
}

export function applicationEmailAttachmentFilename(
  file: ApplicationFileRecord,
  applicant: ApplicationNotificationApplicant | undefined,
  index: number
) {
  const safe = (value: string) => value.normalize("NFKD").replace(/[^a-zA-Z0-9._ -]/g, "_").replace(/\s+/g, "-");
  const role = "primary";
  const name = safe(applicant ? applicantDisplayName(applicant) : "applicant").slice(0, 60) || "applicant";
  const category = safe(file.documentType.replaceAll("_", "-")).slice(0, 50);
  const original = safe(file.originalFilename).slice(-100) || `document-${index + 1}`;
  return `${String(index + 1).padStart(2, "0")}-${role}-${name}-${category}-${original}`.slice(0, 220);
}

export function renderApplicationSubmittedNotification(input: {
  data: ApplicationSubmissionNotificationData;
  appBaseUrl: string;
  attachedFiles: ApplicationFileRecord[];
  partIndex: number;
  partCount: number;
}) {
  const { application, applicants } = input.data;
  const primary = applicants[0];
  const primaryName = primary ? applicantDisplayName(primary) : "Applicant";
  const adminUrl = new URL("/admin/applications", input.appBaseUrl).toString();
  const partLabel = input.partCount > 1 ? ` — attachments ${input.partIndex}/${input.partCount}` : "";
  const subject = `New rental application — ${application.propertyTitle} — ${primaryName}${partLabel}`;
  const attachedRows = input.attachedFiles.map((file) => {
    const applicant = primary;
    return `<tr><td style="border-bottom:1px solid #ECE9E3;padding:10px 8px 10px 0"><strong>${escapeHtml(file.originalFilename)}</strong><br><span style="color:#6B6F6D;font-size:12px">${escapeHtml(APPLICATION_DOCUMENT_LABELS[file.documentType])} · ${escapeHtml(humanize(file.scanStatus))}</span></td><td style="border-bottom:1px solid #ECE9E3;padding:10px 0;text-align:right;vertical-align:top">${escapeHtml(applicant ? applicantDisplayName(applicant) : "Applicant")}<br><span style="color:#6B6F6D;font-size:12px">${Math.ceil(file.byteSize / 1024)} KB</span></td></tr>`;
  }).join("");
  const applicantHtml = applicants.map((applicant, index) => applicantCards(applicant, index)).join("");
  const textFiles = input.attachedFiles.length
    ? input.attachedFiles.map((file) => {
        const applicant = primary;
        return `- ${file.originalFilename} — ${APPLICATION_DOCUMENT_LABELS[file.documentType]} — ${applicant ? applicantDisplayName(applicant) : "Applicant"} — ${Math.ceil(file.byteSize / 1024)} KB`;
      })
    : ["- No uploaded files."];
  const text = [
    "NEW RENTAL APPLICATION",
    `Property: ${application.propertyTitle}`,
    `Address: ${application.propertyAddress}`,
    `Submitted: ${formatDateTime(application.submittedAt)}`,
    `Applicants: ${applicants.length}`,
    `Total supporting files: ${application.files.length}`,
    input.partCount > 1 ? `Attachment email: ${input.partIndex} of ${input.partCount}` : "",
    `Application ID: ${application.id}`,
    "",
    `Review in Admin: ${adminUrl}`,
    "",
    ...applicants.map((applicant, index) => textApplicant(applicant, index)),
    "",
    "FILES ATTACHED TO THIS EMAIL",
    ...textFiles,
    "",
    "SUBMISSION RECORD",
    `Status: ${humanize(application.status)}`,
    `Assigned: ${formatDateTime(application.assignedAt)}`,
    `Last draft update: ${formatDateTime(application.draftUpdatedAt)}`,
    `Consent recorded: ${formatDateTime(application.consentedAt)}`,
    `Form version: ${application.formVersion}`,
    `Form SHA-256: ${application.formSha256}`,
    `Consent version: ${application.termsVersion}`,
    `Consent SHA-256: ${application.termsSha256}`,
    `Retention review date: ${application.retainUntil ?? "—"}`,
    "",
    "Security note: attachments have not completed staff security screening. Handle them only on an approved device."
  ].filter(Boolean).join("\n");

  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>@media only screen and (max-width:660px){.email-shell{padding:12px!important}.email-main{border-radius:10px!important}.summary-cell{display:block!important;width:auto!important}}</style></head><body style="background:#F6F4EF;color:#1F2321;font-family:'IBM Plex Sans','Segoe UI',Arial,sans-serif;margin:0;padding:0"><div style="display:none;max-height:0;overflow:hidden">${escapeHtml(`${applicants.length} applicants · ${application.files.length} supporting files · ${application.propertyAddress}`)}</div><div class="email-shell" style="background:#F6F4EF;padding:28px 16px"><main class="email-main" style="margin:0 auto;max-width:640px">
    <header style="background:#1C2B28;border-radius:14px 14px 0 0;color:#FFFFFF;padding:26px 28px"><div style="color:#9ED0C2;font-size:11px;font-weight:800;letter-spacing:.12em">SILVERKEY · NEW RENTAL APPLICATION</div><h1 style="font-size:26px;line-height:1.2;margin:8px 0 6px">${escapeHtml(application.propertyTitle)}</h1><p style="color:#DCE7E2;font-size:14px;line-height:1.5;margin:0">${escapeHtml(application.propertyAddress)}<br>Submitted ${escapeHtml(formatDateTime(application.submittedAt))}${input.partCount > 1 ? ` · Attachment email ${input.partIndex}/${input.partCount}` : ""}</p></header>
    <div style="background:#FFFFFF;border:1px solid #E4E0DA;border-top:0;padding:24px 28px">
      <table role="presentation" style="border-collapse:separate;border-spacing:8px;margin:-8px;width:calc(100% + 16px)"><tr><td class="summary-cell" style="background:#F6F4EF;border-radius:10px;padding:14px;width:33%"><div style="color:#6B6F6D;font-size:11px;font-weight:700;text-transform:uppercase">Applicants</div><div style="color:#1F2321;font-size:24px;font-weight:800">${applicants.length}</div></td><td class="summary-cell" style="background:#F6F4EF;border-radius:10px;padding:14px;width:33%"><div style="color:#6B6F6D;font-size:11px;font-weight:700;text-transform:uppercase">Total files</div><div style="color:#1F2321;font-size:24px;font-weight:800">${application.files.length}</div></td><td class="summary-cell" style="background:#F6F4EF;border-radius:10px;padding:14px;width:33%"><div style="color:#6B6F6D;font-size:11px;font-weight:700;text-transform:uppercase">Desired move-in</div><div style="color:#1F2321;font-size:16px;font-weight:800">${escapeHtml(primary?.draft.tenancy.desiredMoveInDate || "—")}</div></td></tr></table>
      <p style="margin:20px 0"><a href="${escapeHtml(adminUrl)}" style="background:#2F6F5E;border-radius:8px;color:#FFFFFF;display:inline-block;font-size:14px;font-weight:800;padding:12px 18px;text-decoration:none">Review in Admin</a></p>
      <div style="background:#FFF7E6;border:1px solid #E9C77B;border-radius:10px;color:#6D4B08;font-size:13px;line-height:1.5;margin:0 0 18px;padding:12px 14px"><strong>Security screening pending.</strong> These attachments were validated for allowed file type, but have not completed staff security review. Open only on an approved device.</div>
      ${applicantHtml}
      <section style="background:#FFFFFF;border:1px solid #E4E0DA;border-radius:12px;margin:22px 0 14px;padding:18px 20px"><h2 style="font-size:19px;margin:0 0 4px">Files attached to this email</h2><p style="color:#6B6F6D;font-size:13px;margin:0 0 10px">${input.partCount > 1 ? `Part ${input.partIndex} of ${input.partCount}. ` : ""}${input.attachedFiles.length} file(s) attached.</p><table role="presentation" style="border-collapse:collapse;width:100%">${attachedRows || `<tr><td style="color:#6B6F6D;padding:10px 0">No uploaded files.</td></tr>`}</table></section>
      ${card("Submission record", [["Application ID", application.id], ["Status", humanize(application.status)], ["Assigned", formatDateTime(application.assignedAt)], ["Last draft update", formatDateTime(application.draftUpdatedAt)], ["Consent recorded", formatDateTime(application.consentedAt)], ["Form version", application.formVersion], ["Form SHA-256", application.formSha256], ["Consent version", application.termsVersion], ["Consent SHA-256", application.termsSha256], ["Retention review date", application.retainUntil]])}
    </div><footer style="background:#1C2B28;border-radius:0 0 14px 14px;color:#BFCFC9;font-size:11px;line-height:1.5;padding:18px 28px;text-align:center">Private operational email from Ting Ting Admin. Do not forward outside the authorized application review team.</footer>
  </main></div></body></html>`;

  return { subject, text, html };
}

export function renderApplicationApprovedNotification(input: {
  application: ClientApplicationRecord;
}) {
  const { application } = input;
  const applicantName = [
    application.draft.personal.legalFirstName,
    application.draft.personal.legalLastName
  ].filter(Boolean).join(" ") || "Applicant";
  const safeName = escapeHtml(applicantName);
  const safeProperty = escapeHtml(application.propertyTitle);
  const safeAddress = escapeHtml(application.propertyAddress);

  return {
    subject: `Your rental application has been approved: ${application.propertyTitle}`,
    text: [
      `Hello ${applicantName},`,
      "",
      `Your rental application for ${application.propertyTitle} (${application.propertyAddress}) has been approved.`,
      "Ting Ting’s team will contact you to arrange the next steps.",
      "",
      "This approval email does not create a tenancy and does not replace a signed tenancy agreement.",
      `Application reference: ${application.id}`
    ].join("\n"),
    html: `<p>Hello ${safeName},</p><p>Your rental application for <strong>${safeProperty}</strong> (${safeAddress}) has been approved.</p><p>Ting Ting’s team will contact you to arrange the next steps.</p><p><small>This approval email does not create a tenancy and does not replace a signed tenancy agreement.</small></p><p><small>Application reference: ${escapeHtml(application.id)}</small></p>`
  };
}
