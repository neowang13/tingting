import type { ApplicationDraft } from "@/features/applications/schemas";

export const APPLICATION_FORM_KEY = "residential-rental-application";
export const APPLICATION_FORM_VERSION = "2026-07-31.1";
export const APPLICATION_TERMS_VERSION = "2026-07-31.1";
export const APPLICATION_UPLOAD_BUCKET = "client-applications";
export const APPLICATION_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const APPLICATION_RETENTION_MONTHS = 12;

export const applicationFormText = `TING TING XU — RESIDENTIAL RENTAL APPLICATION
Form version: ${APPLICATION_FORM_VERSION}

Complete the secure online application in Client Login. This downloadable copy is a
fallback only. Do not email completed forms or supporting identity documents.

Rental/property: ______________________________________________
Applicant legal name: _________________________________________
Preferred phone: ______________________________________________
Preferred email: ______________________________________________
Current address: ______________________________________________
Requested move-in date: _______________________________________

Employment/income information relevant to tenancy:
_______________________________________________________________

References (name, relationship, and contact information):
_______________________________________________________________

Other information you want considered:
_______________________________________________________________

Do not sign this downloaded copy. The required authorization and screening consent
are shown and recorded separately when you submit through the Client Login.
`;

export const applicationTermsText = `Application collection and consent notice

Ting Ting Xu/property management collects the completed application and supporting
documents to assess the rental application, verify the information supplied, contact
references, and communicate about the application. Information may be shared with the
landlord of the unit being applied for and with service providers used for authorized
screening and secure processing, only for those purposes.

By affirmatively agreeing at submission, the applicant authorizes the property manager
to share application information with the landlord of the unit and consents to credit-
score and reference checks for the rental application. Declining means the application
cannot be submitted through this workflow. This consent does not include marketing.

Access is limited to authorized applicant and staff accounts. Submitted records are
retained only for the approved operational/legal period, normally 12 months after
submission unless a decision, dispute, legal duty, or authorized retention hold requires
otherwise, then securely deleted or de-identified. To request access, correction,
withdrawal, or deletion review, contact tingtingtech@outlook.com. Withdrawal may not
require deletion where retention is legally required.

Version ${APPLICATION_TERMS_VERSION}. Draft for final legal/privacy review before
production launch. The controller identity, recipient details, screening provider,
credit-check type, retention exceptions, and applicant rights must be confirmed.
`;

export type ApplicationStatus =
  | "draft"
  | "submitted"
  | "received"
  | "needs_information"
  | "under_review"
  | "approved"
  | "declined"
  | "withdrawn";

export interface ClientIdentity {
  userId: string;
  email: string;
  displayName: string;
}

export interface ApplicationFileRecord {
  id: string;
  originalFilename: string;
  mimeType: "application/pdf" | "image/jpeg" | "image/png";
  byteSize: number;
  scanStatus: "screening_pending" | "manual_review_required" | "cleared" | "rejected";
  uploadedAt: string;
}

export interface ClientApplicationRecord {
  id: string;
  ownerUserId: string;
  propertySlug: string | null;
  propertyTitle: string;
  propertyAddress: string;
  status: ApplicationStatus;
  formVersion: string;
  formSha256: string;
  termsVersion: string;
  termsSha256: string;
  legalReviewStatus: "pending" | "approved";
  assignedAt: string;
  submittedAt: string | null;
  consentedAt: string | null;
  retainUntil: string | null;
  draft: ApplicationDraft;
  draftUpdatedAt: string | null;
  files: ApplicationFileRecord[];
}
