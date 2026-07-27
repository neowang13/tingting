export const sectionKeys = [
  "header",
  "hero",
  "rental_search",
  "property_services",
  "featured_rentals",
  "about",
  "contact",
  "footer"
] as const;

export type SectionKey = (typeof sectionKeys)[number];
export type Channel = "email" | "sms";
export type ContactStatus =
  | "unconfirmed"
  | "allowed"
  | "opted_out"
  | "invalid"
  | "bounced"
  | "complained"
  | "suppressed";
export type RentalStatus = "draft" | "published" | "archived";
export type NotificationStatus =
  | "scheduled"
  | "processing"
  | "queued"
  | "sent"
  | "delivered"
  | "failed"
  | "undelivered"
  | "skipped"
  | "unknown"
  | "expired"
  | "cancelled";

export interface Versioned {
  updatedAt: string;
}

export interface SiteSection extends Versioned {
  key: SectionKey;
  displayName: string;
  schemaVersion: number;
  draftContent: unknown;
  publishedContent: unknown;
  publishedAt: string | null;
}

export interface PublicSiteSection {
  key: SectionKey;
  schemaVersion: number;
  publishedContent: unknown;
  publishedAt: string | null;
}

export interface SectionRevision {
  id: string;
  sectionKey: SectionKey;
  schemaVersion: number;
  content: unknown;
  createdAt: string;
}

export interface MediaAsset {
  id: string;
  state: "draft" | "published" | "archived";
  originalFilename: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp" | "image/avif";
  byteSize: number;
  width: number;
  height: number;
  altText: string;
  previewUrl: string | null;
  publicUrl: string | null;
  createdAt: string;
}

export interface RentalListing extends Versioned {
  id: string;
  slug: string;
  title: string;
  addressLine: string;
  neighbourhood: string | null;
  city: string;
  monthlyRentCents: number;
  bedrooms: number;
  bathrooms: number;
  squareFeet: number | null;
  availableOn: string | null;
  petPolicy: string | null;
  description: string;
  status: RentalStatus;
  sortOrder: number;
  coverImageUrl: string | null;
  images: RentalImage[];
  createdAt: string;
  publishedAt: string | null;
}

export interface RentalImage {
  mediaAssetId: string;
  url: string | null;
  alt: string;
  sortOrder: number;
  isCover: boolean;
}

export interface Tenant extends Versioned {
  id: string;
  fullName: string;
  propertyLabel: string;
  unitLabel: string | null;
  email: string | null;
  phoneE164: string | null;
  preferredChannels: Channel[];
  emailContactStatus: ContactStatus;
  smsContactStatus: Exclude<ContactStatus, "bounced" | "complained">;
  emailContactStatusReason: string | null;
  smsContactStatusReason: string | null;
  emailContactStatusSource: string | null;
  smsContactStatusSource: string | null;
  contactPermissionNote: string | null;
  contactPermissionUpdatedAt: string | null;
  timezone: string;
  internalNotes: string | null;
  isActive: boolean;
  archivedAt: string | null;
  createdAt: string;
}

export interface NotificationTemplate extends Versioned {
  id: string;
  name: string;
  channel: Channel;
  subjectTemplate: string | null;
  bodyTemplate: string;
  isActive: boolean;
  createdAt: string;
}

export interface ReminderSchedule extends Versioned {
  id: string;
  tenantId: string;
  rentDueDay: number;
  dayOfMonth: number;
  localTime: string;
  timezone: string;
  channels: Channel[];
  emailTemplateId: string | null;
  smsTemplateId: string | null;
  isEnabled: boolean;
  nextRunAt: string | null;
  lastProcessedAt: string | null;
  createdAt: string;
}

export interface NotificationEvent {
  id: string;
  tenantId: string;
  source: "scheduled" | "manual" | "test" | "retry";
  channel: Channel;
  occurrenceKey: string;
  occurrenceLocalDate: string;
  scheduledFor: string;
  status: NotificationStatus;
  destinationMasked: string | null;
  provider: string | null;
  providerMessageId: string | null;
  providerStatus: string | null;
  attemptCount: number;
  lastErrorCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationBatch {
  id: string;
  requestId: string;
  selectedCount: number;
  eligibleCount: number;
  status:
    | "draft"
    | "confirmed"
    | "processing"
    | "completed"
    | "partial"
    | "failed"
    | "expired";
  requestedChannels: Channel[];
  expiresAt: string;
  confirmedAt: string | null;
  createdAt: string;
}

export interface DashboardSummary {
  activeTenants: number;
  enabledSchedules: number;
  dueNextSevenDays: number;
  failedLastThirtyDays: number;
  outboxBacklog: number;
  remindersPaused: boolean;
  lastWorkerRunAt: string | null;
  latestWorkerStatus: string | null;
  oldestEligibleEventAt: string | null;
  warnings: string[];
}

export interface TestContacts {
  email: string | null;
  phoneE164: string | null;
  updatedAt: string;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  requestId: string;
}

export interface ApiFailure {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  requestId: string;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;
