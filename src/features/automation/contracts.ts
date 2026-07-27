import type {
  Channel,
  ContactStatus,
  ReminderSchedule,
  RentalListing,
  Tenant
} from "@/lib/contracts";

export const automationScopes = [
  "rentals:read",
  "rentals:write",
  "rentals:publish",
  "media:write",
  "tenants:read",
  "tenants:write",
  "tenants:import",
  "permissions:grant",
  "schedules:read",
  "schedules:write",
  "schedules:enable",
  "jobs:read"
] as const;

export type AutomationScope = (typeof automationScopes)[number];

export interface AutomationActor {
  serviceAccountId: string;
  serviceAccountName: string;
  delegatedAdminUserId: string;
  requestId: string;
  scopes: AutomationScope[];
}

export interface AutomationServiceAccount {
  id: string;
  name: string;
  delegatedAdminUserId: string;
  delegatedAdminDisplayName: string;
  scopes: AutomationScope[];
  isActive: boolean;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  tokens: Array<{
    id: string;
    prefix: string;
    isActive: boolean;
    expiresAt: string | null;
    lastUsedAt: string | null;
    revokedAt: string | null;
    createdAt: string;
  }>;
}

export type AutomationConfirmationAction =
  | "rental.publish"
  | "rental.unpublish"
  | "rental.archive"
  | "tenant_import.commit"
  | "tenant.permission.grant"
  | "tenant.archive"
  | "schedule.enable"
  | "schedule.disable";

export interface AutomationConfirmationIntent {
  id: string;
  serviceAccountId: string;
  action: AutomationConfirmationAction;
  targetType: string;
  targetId: string;
  targetVersion: string | null;
  digest: string;
  payload: Record<string, unknown>;
  summary: {
    title: string;
    effects: string[];
    warnings: string[];
  };
  requiredAcknowledgements: string[];
  expiresAt: string;
  consumedAt: string | null;
  createdAt: string;
}

export type AutomationJobStatus =
  | "queued"
  | "running"
  | "preview_ready"
  | "awaiting_confirmation"
  | "committing"
  | "completed"
  | "failed"
  | "cancelled";

export type TenantImportOutcome =
  | "new"
  | "update"
  | "unchanged"
  | "duplicate"
  | "conflict"
  | "invalid";

export interface TenantImportRow {
  id: string;
  rowNumber: number;
  rowDigest: string;
  outcome: TenantImportOutcome;
  matchedTenantId: string | null;
  expectedTenantVersion: string | null;
  normalizedPayload: NormalizedTenantImportRow | null;
  changedFields: string[];
  errorCodes: string[];
  warnings: string[];
  display: string;
  emailMasked: string | null;
  phoneMasked: string | null;
}

export interface TenantImportBatch {
  id: string;
  jobId: string;
  serviceAccountId: string;
  sourceSystem: string;
  importMode: "create_only" | "create_or_update";
  originalFilename: string;
  sourceDigest: string;
  rowCount: number;
  counts: Record<TenantImportOutcome, number>;
  previewVersion: string;
  committedAt: string | null;
  createdAt: string;
  status: AutomationJobStatus;
  rows: TenantImportRow[];
}

export interface NormalizedTenantImportRow {
  externalReference: string | null;
  fullName: string;
  propertyLabel: string;
  unitLabel: string | null;
  email: string | null;
  phoneE164: string | null;
  preferredChannels: Channel[];
  emailContactStatus: ContactStatus;
  smsContactStatus: Exclude<ContactStatus, "bounced" | "complained">;
  emailPermissionSource: string | null;
  emailPermissionRecordedAt: string | null;
  emailEvidenceReference: string | null;
  smsPermissionSource: string | null;
  smsPermissionRecordedAt: string | null;
  smsEvidenceReference: string | null;
  timezone: string;
  internalNotes: string | null;
  isActive: boolean;
  schedule: Omit<ReminderSchedule, "id" | "tenantId" | "createdAt" | "updatedAt" | "nextRunAt" | "lastProcessedAt"> | null;
}

export interface AutomationRental extends RentalListing {
  sourceSystem: string | null;
  externalReference: string | null;
}

export interface AutomationTenant extends Tenant {
  sourceSystem: string | null;
  externalReference: string | null;
}

export interface AutomationHealth {
  apiVersion: "v1";
  serverTime: string;
  dataBackend: "memory" | "supabase";
  durableBackendReady: boolean;
  providerMode: "mock" | "disabled" | "live";
  remindersForcePaused: boolean;
  remindersGlobalPaused: boolean;
  effectiveReminderPause: boolean;
  featureFlags: {
    api: boolean;
    mutations: boolean;
    confirmations: boolean;
    tenantImport: boolean;
  };
}

