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
