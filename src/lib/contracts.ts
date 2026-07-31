export const homepageSectionKeys = [
  "header",
  "hero",
  "rental_search",
  "property_services",
  "featured_rentals",
  "about",
  "contact",
  "footer"
] as const;

export const servicePageSectionKeys = [
  "service_renovation",
  "service_handyman",
  "service_maintenance",
  "service_strata",
  "service_rental_management"
] as const;

export const sectionKeys = [
  ...homepageSectionKeys,
  ...servicePageSectionKeys
] as const;

export type HomepageSectionKey = (typeof homepageSectionKeys)[number];
export type ServicePageSectionKey = (typeof servicePageSectionKeys)[number];
export type SectionKey = (typeof sectionKeys)[number];

export function isHomepageSectionKey(key: SectionKey): key is HomepageSectionKey {
  return (homepageSectionKeys as readonly SectionKey[]).includes(key);
}

export function isServicePageSectionKey(key: SectionKey): key is ServicePageSectionKey {
  return (servicePageSectionKeys as readonly SectionKey[]).includes(key);
}

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
export type PropertyType =
  | "apartment"
  | "condo"
  | "townhome"
  | "house"
  | "basement_suite"
  | "room"
  | "other";
export type AvailabilityStatus = "available_now" | "available_on" | "contact";
export type FurnishedStatus = "unfurnished" | "furnished" | "partly_furnished";
export type LeaseType = "fixed_term" | "month_to_month" | "flexible";
export type TenantLeaseType = "fixed_term" | "month_to_month";
export type SmokingPolicy = "not_allowed" | "outdoor_only" | "allowed" | "contact";
export type PetStatus = "not_allowed" | "considered" | "allowed";
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
  property?: RentalProperty;
  currencyCode?: "CAD";
  denCount?: number;
  availabilityStatus?: AvailabilityStatus | null;
  furnishedStatus?: FurnishedStatus | null;
  leaseType?: LeaseType | null;
  minimumLeaseMonths?: number | null;
  parking?: RentalParking;
  storage?: RentalStorage;
  pets?: RentalPetPolicy;
  smokingPolicy?: SmokingPolicy | null;
  creditCheckRequired?: boolean | null;
  referencesRequired?: boolean | null;
  amenityCodes?: string[];
  includedUtilityCodes?: string[];
  fees?: RentalFee[];
  contact?: RentalContact;
  utilitiesNotes?: string | null;
  amenityNotes?: string | null;
  draftDigest?: string | null;
  publishedSourceDigest?: string | null;
  reviewRequiredFields?: string[];
}

export interface RentalImage {
  mediaAssetId: string;
  url: string | null;
  alt: string;
  sortOrder: number;
  isCover: boolean;
}

export interface RentalProperty extends Versioned {
  id: string | null;
  propertyType: PropertyType | null;
  buildingName: string | null;
  unitNumber: string | null;
  streetAddress: string;
  neighbourhood: string | null;
  city: string;
  provinceCode: string | null;
  postalCode: string | null;
  countryCode: "CA";
}

export interface RentalParking {
  available: boolean | null;
  type: "underground" | "garage" | "surface" | "street" | "carport" | "other" | null;
  stalls: number | null;
  included: boolean | null;
  visitorAvailable: boolean | null;
  notes: string | null;
}

export interface RentalStorage {
  available: boolean | null;
  lockers: number | null;
  included: boolean | null;
  notes: string | null;
}

export interface RentalPetPolicy {
  status: PetStatus | null;
  catsAllowed: boolean;
  dogsAllowed: boolean;
  maxCount: number | null;
  sizeLimitLbs: number | null;
  notes: string | null;
}

export interface RentalContact {
  mode: "site_default" | "custom";
  name: string | null;
  email: string | null;
  phone: string | null;
}

export interface RentalFee {
  id?: string;
  feeType: "security_deposit" | "pet_deposit" | "parking" | "storage" | "move_in" | "other";
  label: string | null;
  amountCents: number;
  frequency: "one_time" | "monthly";
  refundable: boolean;
  required: boolean;
  notes: string | null;
  sortOrder: number;
}

export interface Tenant extends Versioned {
  id: string;
  fullName: string;
  propertyLabel: string;
  unitLabel: string | null;
  moveInDate: string | null;
  leaseType: TenantLeaseType | null;
  leaseEndDate: string | null;
  rentDueDay: number;
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
  scheduleStatus?: "enabled" | "disabled" | "missing";
  nextRunAt?: string | null;
  lastDeliveryStatus?: NotificationStatus | null;
  lastDeliveryAt?: string | null;
  currentRentPayment?: TenantRentPayment | null;
}

export type RentPaymentStatus = "due" | "collected";

export interface TenantRentPayment extends Versioned {
  id: string;
  tenantId: string;
  paymentPeriod: string;
  dueDate: string;
  status: RentPaymentStatus;
  receiptId: string | null;
  collectedAt: string | null;
  collectedByType: "admin" | "automation" | null;
  collectedById: string | null;
  note: string | null;
  createdAt: string;
}

export interface TenantRentPaymentReceipt {
  id: string;
  tenantId: string;
  paymentPeriod: string;
  originalFilename: string;
  mimeType: "application/pdf" | "image/jpeg" | "image/png" | "image/webp";
  byteSize: number;
  sha256Digest: string;
  createdAt: string;
}

export interface RentPaymentDetail {
  tenant: Tenant;
  payment: TenantRentPayment;
}

export interface LeaseExpiryDetail {
  tenant: Tenant;
  daysRemaining: number;
}

export interface RentReportSnapshot {
  timezone: string;
  generatedThrough: string;
  weekStart: string;
  weekEnd: string;
  nextWeekStart: string;
  nextWeekEnd: string;
  leaseExpiryWindowEnd: string;
  thisWeek: {
    due: RentPaymentDetail[];
    collected: RentPaymentDetail[];
    outstanding: RentPaymentDetail[];
  };
  nextWeek: {
    due: RentPaymentDetail[];
    collectedEarly: RentPaymentDetail[];
    outstanding: RentPaymentDetail[];
  };
  overdue: Array<RentPaymentDetail & { daysOverdue: number }>;
  leases: {
    monthToMonthCount: number;
    expiringWithin7Days: LeaseExpiryDetail[];
    expiringWithin30Days: LeaseExpiryDetail[];
    expiredActive: LeaseExpiryDetail[];
  };
  recentCollections: RentPaymentDetail[];
}

export type OwnerNotificationKind =
  | "tenant_upload"
  | "weekly_tenant_summary"
  | "daily_overdue_rent_summary";

export interface OwnerNotificationDelivery {
  id: string;
  notificationKey: string;
  kind: OwnerNotificationKind;
  tenantId: string | null;
  payload: Record<string, unknown>;
  attemptCount: number;
}

export interface TenantActivitySummary {
  activeCount: number;
  periodNewCount: number;
  periodNewTenants: Tenant[];
  todayNewCount: number;
  todayNewTenants: Tenant[];
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

export interface ReminderSettings {
  businessName: string;
  paused: boolean;
  leadDays: number;
  localTime: string;
  timezone: string;
  emailTemplateId: string | null;
  updatedAt: string;
  recalculatedTenants?: number;
  preservedDueTenants?: number;
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

export interface TenantListFilters {
  query?: string;
  lifecycle?: "active" | "inactive" | "archived";
  contact?: "email_allowed" | "email_blocked" | "sms_allowed" | "sms_blocked";
  schedule?: "enabled" | "disabled" | "missing";
  rentStatus?: RentPaymentStatus;
  leaseType?: TenantLeaseType | "needs_details";
  limit?: number;
}

export interface NotificationEventFilters {
  tenantId?: string;
  channel?: Channel;
  status?: NotificationStatus;
  scheduledFrom?: string;
  scheduledTo?: string;
  limit?: number;
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
