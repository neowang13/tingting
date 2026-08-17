import type { ClientApplicationRecord } from "@/features/applications/contracts";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function renderApplicationSubmittedNotification(input: {
  application: ClientApplicationRecord;
  appBaseUrl: string;
}) {
  const { application } = input;
  const applicantName = [
    application.draft.personal.legalFirstName,
    application.draft.personal.legalLastName
  ].filter(Boolean).join(" ") || "Applicant";
  const adminUrl = new URL("/admin/applications", input.appBaseUrl).toString();
  const details = [
    "Status: SUBMITTED",
    `Applicant: ${applicantName}`,
    `Applicant email: ${application.draft.personal.email}`,
    `Property: ${application.propertyTitle}`,
    `Address: ${application.propertyAddress}`,
    `Submitted: ${application.submittedAt ?? "Unknown"}`,
    `Application ID: ${application.id}`
  ];

  return {
    subject: `Rental application submitted: ${application.propertyTitle}`,
    text: [
      ...details,
      "",
      `Review securely in Admin: ${adminUrl}`,
      "Supporting documents are intentionally not attached to this email."
    ].join("\n"),
    html: `<p><strong>New rental application submitted</strong></p><p>${details.map(escapeHtml).join("<br>")}</p><p><a href="${escapeHtml(adminUrl)}">Review securely in Admin</a></p><p>Supporting documents are intentionally not attached to this email.</p>`
  };
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
