import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { validateSection } from "@/features/content/schemas";
import { collectMediaAssetIds } from "@/features/content/media-service";
import { nextOccurrence } from "@/features/reminders/scheduler";
import {
  createNotificationProviders,
  resolveNotificationProviderMode
} from "@/features/notifications/providers";
import { ApiError } from "@/lib/api";
import type {
  DashboardSummary,
  NotificationBatch,
  NotificationEvent,
  NotificationTemplate,
  ReminderSchedule,
  RentalListing,
  SectionRevision,
  SectionKey,
  SiteSection,
  Tenant,
  TestContacts
} from "@/lib/contracts";
import {
  batchConfirmSchema,
  notificationPreviewSchema,
  rentalInputSchema,
  scheduleInputSchema,
  templateInputSchema,
  testContactsInputSchema,
  testNotificationSchema,
  tenantInputSchema
} from "@/lib/schemas";
import type { DataRepository } from "@/data/repository";

type Row = Record<string, unknown>;

function asRow(value: unknown): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(500, "INVALID_DATABASE_RESPONSE", "The database returned an invalid record.");
  }
  return value as Row;
}

function asRows(value: unknown): Row[] {
  if (!Array.isArray(value)) {
    throw new ApiError(500, "INVALID_DATABASE_RESPONSE", "The database returned an invalid collection.");
  }
  return value.map(asRow);
}

function text(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== "string") {
    throw new ApiError(500, "INVALID_DATABASE_RESPONSE", `Database field ${key} is invalid.`);
  }
  return value;
}

function nullableText(row: Row, key: string): string | null {
  const value = row[key];
  return value === null || value === undefined ? null : String(value);
}

function numberValue(row: Row, key: string): number {
  const value = Number(row[key]);
  if (!Number.isFinite(value)) {
    throw new ApiError(500, "INVALID_DATABASE_RESPONSE", `Database field ${key} is invalid.`);
  }
  return value;
}

function booleanValue(row: Row, key: string): boolean {
  if (typeof row[key] !== "boolean") {
    throw new ApiError(500, "INVALID_DATABASE_RESPONSE", `Database field ${key} is invalid.`);
  }
  return row[key];
}

function stringArray(row: Row, key: string): string[] {
  const value = row[key];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new ApiError(500, "INVALID_DATABASE_RESPONSE", `Database field ${key} is invalid.`);
  }
  return value;
}

function databaseError(error: { code?: string; message: string } | null): never {
  const conflictCodes = new Set(["23505", "P0002", "TT409"]);
  throw new ApiError(
    conflictCodes.has(error?.code ?? "") ? 409 : 500,
    conflictCodes.has(error?.code ?? "") ? "VERSION_CONFLICT" : "DATABASE_ERROR",
    conflictCodes.has(error?.code ?? "") ? "This record changed after it was loaded." : "The database request failed."
  );
}

function mapSection(value: unknown): SiteSection {
  const row = asRow(value);
  return {
    key: text(row, "key") as SectionKey,
    displayName: text(row, "display_name"),
    schemaVersion: numberValue(row, "schema_version"),
    draftContent: row.draft_content,
    publishedContent: row.published_content,
    publishedAt: nullableText(row, "published_at"),
    updatedAt: text(row, "updated_at")
  };
}

function mapSectionRevision(value: unknown): SectionRevision {
  const row = asRow(value);
  return {
    id: text(row, "id"),
    sectionKey: text(row, "section_key") as SectionKey,
    schemaVersion: numberValue(row, "schema_version"),
    content: row.content,
    createdAt: text(row, "created_at")
  };
}

function mapRental(value: unknown): RentalListing {
  const row = asRow(value);
  const rawImages = Array.isArray(row.images) ? row.images : [];
  const images = rawImages.map((value) => {
    const image = asRow(value);
    return {
      mediaAssetId: text(image, "mediaAssetId"),
      url: nullableText(image, "url"),
      alt: text(image, "alt"),
      sortOrder: numberValue(image, "sortOrder"),
      isCover: booleanValue(image, "isCover")
    };
  });
  return {
    id: text(row, "id"),
    slug: text(row, "slug"),
    title: text(row, "title"),
    addressLine: text(row, "address_line"),
    neighbourhood: nullableText(row, "neighbourhood"),
    city: text(row, "city"),
    monthlyRentCents: numberValue(row, "monthly_rent_cents"),
    bedrooms: numberValue(row, "bedrooms"),
    bathrooms: numberValue(row, "bathrooms"),
    squareFeet: row.square_feet === null ? null : numberValue(row, "square_feet"),
    availableOn: nullableText(row, "available_on"),
    petPolicy: nullableText(row, "pet_policy"),
    description: text(row, "description"),
    status: text(row, "status") as RentalListing["status"],
    sortOrder: numberValue(row, "sort_order"),
    coverImageUrl: nullableText(row, "cover_image_url"),
    images,
    createdAt: text(row, "created_at"),
    updatedAt: text(row, "updated_at"),
    publishedAt: nullableText(row, "published_at")
  };
}

function mapTenant(value: unknown): Tenant {
  const row = asRow(value);
  return {
    id: text(row, "id"),
    fullName: text(row, "full_name"),
    propertyLabel: text(row, "property_label"),
    unitLabel: nullableText(row, "unit_label"),
    email: nullableText(row, "email"),
    phoneE164: nullableText(row, "phone_e164"),
    preferredChannels: stringArray(row, "preferred_channels") as Tenant["preferredChannels"],
    emailContactStatus: text(row, "email_contact_status") as Tenant["emailContactStatus"],
    smsContactStatus: text(row, "sms_contact_status") as Tenant["smsContactStatus"],
    emailContactStatusReason: nullableText(row, "email_contact_status_reason"),
    smsContactStatusReason: nullableText(row, "sms_contact_status_reason"),
    emailContactStatusSource: nullableText(row, "email_contact_status_source"),
    smsContactStatusSource: nullableText(row, "sms_contact_status_source"),
    contactPermissionNote: nullableText(row, "contact_permission_note"),
    contactPermissionUpdatedAt: nullableText(row, "contact_permission_updated_at"),
    timezone: text(row, "timezone"),
    internalNotes: nullableText(row, "internal_notes"),
    isActive: booleanValue(row, "is_active"),
    archivedAt: nullableText(row, "archived_at"),
    createdAt: text(row, "created_at"),
    updatedAt: text(row, "updated_at")
  };
}

function mapSchedule(value: unknown): ReminderSchedule {
  const row = asRow(value);
  return {
    id: text(row, "id"),
    tenantId: text(row, "tenant_id"),
    rentDueDay: numberValue(row, "rent_due_day"),
    dayOfMonth: numberValue(row, "day_of_month"),
    localTime: text(row, "local_time").slice(0, 5),
    timezone: text(row, "timezone"),
    channels: stringArray(row, "channels") as ReminderSchedule["channels"],
    emailTemplateId: nullableText(row, "email_template_id"),
    smsTemplateId: nullableText(row, "sms_template_id"),
    isEnabled: booleanValue(row, "is_enabled"),
    nextRunAt: nullableText(row, "next_run_at"),
    lastProcessedAt: nullableText(row, "last_processed_at"),
    createdAt: text(row, "created_at"),
    updatedAt: text(row, "updated_at")
  };
}

function mapTemplate(value: unknown): NotificationTemplate {
  const row = asRow(value);
  return {
    id: text(row, "id"),
    name: text(row, "name"),
    channel: text(row, "channel") as NotificationTemplate["channel"],
    subjectTemplate: nullableText(row, "subject_template"),
    bodyTemplate: text(row, "body_template"),
    isActive: booleanValue(row, "is_active"),
    createdAt: text(row, "created_at"),
    updatedAt: text(row, "updated_at")
  };
}

function mapEvent(value: unknown): NotificationEvent {
  const row = asRow(value);
  return {
    id: text(row, "id"),
    tenantId: text(row, "tenant_id"),
    source: text(row, "source") as NotificationEvent["source"],
    channel: text(row, "channel") as NotificationEvent["channel"],
    occurrenceKey: text(row, "occurrence_key"),
    occurrenceLocalDate: text(row, "occurrence_local_date"),
    scheduledFor: text(row, "scheduled_for"),
    status: text(row, "status") as NotificationEvent["status"],
    destinationMasked: nullableText(row, "destination_masked"),
    provider: nullableText(row, "provider"),
    providerMessageId: nullableText(row, "provider_message_id"),
    providerStatus: nullableText(row, "provider_status"),
    attemptCount: numberValue(row, "attempt_count"),
    lastErrorCode: nullableText(row, "last_error_code"),
    createdAt: text(row, "created_at"),
    updatedAt: text(row, "updated_at")
  };
}

function mapBatch(value: unknown): NotificationBatch {
  const row = asRow(value);
  return {
    id: text(row, "id"),
    requestId: text(row, "request_id"),
    selectedCount: numberValue(row, "selected_count"),
    eligibleCount: numberValue(row, "eligible_count"),
    status: text(row, "status") as NotificationBatch["status"],
    requestedChannels: stringArray(row, "requested_channels") as NotificationBatch["requestedChannels"],
    expiresAt: text(row, "expires_at"),
    confirmedAt: nullableText(row, "confirmed_at"),
    createdAt: text(row, "created_at")
  };
}

export class SupabaseRepository implements DataRepository {
  private clientInstance?: SupabaseClient;

  private client() {
    if (this.clientInstance) return this.clientInstance;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new ApiError(503, "SUPABASE_NOT_CONFIGURED", "Supabase persistence is not configured.");
    }
    this.clientInstance = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    return this.clientInstance;
  }

  private async rpc(name: string, args: Row): Promise<unknown> {
    const { data, error } = await this.client().rpc(name, args);
    if (error) databaseError(error);
    return data;
  }

  async dashboard(): Promise<DashboardSummary> {
    const data = asRow(await this.rpc("admin_dashboard_summary", {}));
    return {
      activeTenants: numberValue(data, "active_tenants"),
      enabledSchedules: numberValue(data, "enabled_schedules"),
      dueNextSevenDays: numberValue(data, "due_next_seven_days"),
      failedLastThirtyDays: numberValue(data, "failed_last_thirty_days"),
      outboxBacklog: numberValue(data, "outbox_backlog"),
      remindersPaused: booleanValue(data, "reminders_paused"),
      lastWorkerRunAt: nullableText(data, "last_worker_run_at"),
      latestWorkerStatus: nullableText(data, "latest_worker_status"),
      oldestEligibleEventAt: nullableText(data, "oldest_eligible_event_at"),
      warnings: Array.isArray(data.warnings) ? data.warnings.map(String) : []
    };
  }

  async listSections() {
    const { data, error } = await this.client().from("site_sections").select("*").order("sort_order");
    if (error) databaseError(error);
    return asRows(data).map(mapSection);
  }

  async listPublicSections() {
    const { data, error } = await this.client()
      .from("public_site_sections")
      .select("key,schema_version,published_content,published_at");
    if (error) databaseError(error);
    return asRows(data).map((row) => ({
      key: text(row, "key") as SectionKey,
      schemaVersion: numberValue(row, "schema_version"),
      publishedContent: row.published_content,
      publishedAt: nullableText(row, "published_at")
    }));
  }

  async resolvePublicMedia(ids: string[]) {
    if (ids.length === 0) return {};
    const { data, error } = await this.client()
      .from("media_assets")
      .select("id,public_url")
      .in("id", ids)
      .eq("state", "published");
    if (error) databaseError(error);
    const result = Object.fromEntries(ids.map((id) => [id, null])) as Record<string, string | null>;
    for (const row of asRows(data)) result[text(row, "id")] = nullableText(row, "public_url");
    return result;
  }

  async getSection(key: SectionKey) {
    const { data, error } = await this.client().from("site_sections").select("*").eq("key", key).single();
    if (error) databaseError(error);
    return mapSection(data);
  }

  async listSectionRevisions(key: SectionKey) {
    const { data, error } = await this.client()
      .from("site_section_revisions")
      .select("id,section_key,schema_version,content,created_at")
      .eq("section_key", key)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) databaseError(error);
    return asRows(data).map(mapSectionRevision);
  }

  async saveSectionDraft(key: SectionKey, content: unknown, expectedVersion: unknown, actorId: string) {
    const validated = validateSection(key, content);
    return mapSection(await this.rpc("save_section_draft", {
      p_key: key,
      p_content: validated,
      p_expected_updated_at: expectedVersion,
      p_actor_id: actorId
    }));
  }

  async publishSection(key: SectionKey, expectedVersion: unknown, actorId: string) {
    const current = await this.getSection(key);
    validateSection(key, current.draftContent);
    const media = await this.promoteMediaForPublish(collectMediaAssetIds(current.draftContent));
    return mapSection(await this.rpc("publish_site_section_with_media", {
      p_key: key,
      p_expected_updated_at: expectedVersion,
      p_actor_id: actorId,
      p_media: media
    }));
  }

  async rollbackSection(key: SectionKey, revisionId: unknown, expectedVersion: unknown, actorId: string) {
    return mapSection(await this.rpc("rollback_site_section", {
      p_key: key,
      p_revision_id: revisionId,
      p_expected_updated_at: expectedVersion,
      p_actor_id: actorId
    }));
  }

  async listRentals(includePrivate = true) {
    const source = includePrivate ? "admin_rental_listings" : "public_rental_listings";
    const { data, error } = await this.client().from(source).select("*").order("sort_order");
    if (error) databaseError(error);
    return asRows(data).map((row) =>
      mapRental({
        status: "published",
        created_at: row.published_at,
        updated_at: row.published_at,
        ...row
      })
    );
  }

  async getRental(id: string) {
    const { data, error } = await this.client().from("admin_rental_listings").select("*").eq("id", id).single();
    if (error) databaseError(error);
    return mapRental(data);
  }

  async createRental(payload: unknown, actorId: string) {
    const input = rentalInputSchema.parse(payload);
    return mapRental(await this.rpc("save_rental_listing", {
      p_id: null,
      p_payload: input,
      p_expected_updated_at: null,
      p_actor_id: actorId
    }));
  }

  async updateRental(id: string, payload: unknown, expectedVersion: unknown, actorId: string) {
    const input = rentalInputSchema.parse(payload);
    return mapRental(await this.rpc("save_rental_listing", {
      p_id: id,
      p_payload: input,
      p_expected_updated_at: expectedVersion,
      p_actor_id: actorId
    }));
  }

  async setRentalStatus(
    id: string,
    action: "publish" | "unpublish" | "archive",
    expectedVersion: unknown,
    actorId: string
  ) {
    const rental = await this.getRental(id);
    const media = action === "publish"
      ? await this.promoteMediaForPublish(rental.images.map((image) => image.mediaAssetId))
      : [];
    return mapRental(await this.rpc("set_rental_status_with_media", {
      p_id: id,
      p_action: action,
      p_expected_updated_at: expectedVersion,
      p_actor_id: actorId,
      p_media: media
    }));
  }

  async executeAutomationResourceConfirmation(input: {
    confirmationId: string;
    serviceAccountId: string;
    idempotencyKey: string;
    targetId: string;
    action: "rental.publish" | "rental.unpublish" | "rental.archive" | "schedule.enable" | "schedule.disable";
  }) {
    let media: Array<{ id: string; path: string; url: string }> = [];
    if (input.action === "rental.publish") {
      const rental = await this.getRental(input.targetId);
      media = await this.promoteMediaForPublish(
        rental.images.map((image) => image.mediaAssetId)
      );
    }
    const result = await this.rpc("execute_automation_resource_confirmation", {
      p_confirmation_id: input.confirmationId,
      p_service_account_id: input.serviceAccountId,
      p_idempotency_key: input.idempotencyKey,
      p_now: new Date().toISOString(),
      p_media: media
    });
    return input.action.startsWith("rental.")
      ? mapRental(result)
      : mapSchedule(result);
  }

  async listTenants() {
    const { data, error } = await this.client().from("tenants").select("*").order("full_name");
    if (error) databaseError(error);
    return asRows(data).map(mapTenant);
  }

  async getTenant(id: string) {
    const { data, error } = await this.client().from("tenants").select("*").eq("id", id).single();
    if (error) databaseError(error);
    const { data: schedule, error: scheduleError } = await this.client()
      .from("reminder_schedules")
      .select("*")
      .eq("tenant_id", id)
      .maybeSingle();
    if (scheduleError) databaseError(scheduleError);
    return { tenant: mapTenant(data), schedule: schedule ? mapSchedule(schedule) : null };
  }

  async createTenant(payload: unknown, actorId: string) {
    const input = tenantInputSchema.parse(payload);
    return mapTenant(await this.rpc("save_tenant", {
      p_id: null,
      p_payload: input,
      p_expected_updated_at: null,
      p_actor_id: actorId
    }));
  }

  async updateTenant(id: string, payload: unknown, expectedVersion: unknown, actorId: string) {
    const input = tenantInputSchema.parse(payload);
    return mapTenant(await this.rpc("save_tenant", {
      p_id: id,
      p_payload: input,
      p_expected_updated_at: expectedVersion,
      p_actor_id: actorId
    }));
  }

  async archiveTenant(id: string, expectedVersion: unknown, actorId: string) {
    return mapTenant(await this.rpc("archive_tenant", {
      p_id: id,
      p_expected_updated_at: expectedVersion,
      p_actor_id: actorId
    }));
  }

  async saveSchedule(tenantId: string, payload: unknown, expectedVersion: unknown, actorId: string) {
    const input = scheduleInputSchema.parse(payload);
    const nextRunAt = input.isEnabled
      ? nextOccurrence({
          dayOfMonth: input.dayOfMonth,
          localTime: input.localTime,
          timezone: input.timezone,
          afterInstant: new Date().toISOString()
        })
      : null;
    return mapSchedule(await this.rpc("save_reminder_schedule", {
      p_tenant_id: tenantId,
      p_payload: { ...input, nextRunAt },
      p_expected_updated_at: expectedVersion,
      p_actor_id: actorId
    }));
  }

  async listTemplates() {
    const { data, error } = await this.client().from("notification_templates").select("*").order("name");
    if (error) databaseError(error);
    return asRows(data).map(mapTemplate);
  }

  async createTemplate(payload: unknown, actorId: string) {
    const input = templateInputSchema.parse(payload);
    return mapTemplate(await this.rpc("save_notification_template", {
      p_id: null,
      p_payload: input,
      p_expected_updated_at: null,
      p_actor_id: actorId
    }));
  }

  async updateTemplate(id: string, payload: unknown, expectedVersion: unknown, actorId: string) {
    const input = templateInputSchema.parse(payload);
    return mapTemplate(await this.rpc("save_notification_template", {
      p_id: id,
      p_payload: input,
      p_expected_updated_at: expectedVersion,
      p_actor_id: actorId
    }));
  }

  async listEvents() {
    const { data, error } = await this.client()
      .from("notification_events")
      .select("id,tenant_id,source,channel,occurrence_key,occurrence_local_date,scheduled_for,status,destination_masked,provider,provider_message_id,provider_status,attempt_count,last_error_code,created_at,updated_at")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) databaseError(error);
    return asRows(data).map(mapEvent);
  }

  async previewNotification(payload: unknown) {
    const input = notificationPreviewSchema.parse(payload);
    return this.rpc("preview_notification_batch", { p_payload: input });
  }

  async createBatch(payload: unknown, actorId: string) {
    const input = notificationPreviewSchema.parse(payload);
    return mapBatch(await this.rpc("create_notification_batch", { p_payload: input, p_actor_id: actorId }));
  }

  async confirmBatch(id: string, payload: unknown, actorId: string) {
    const input = batchConfirmSchema.parse(payload);
    return mapBatch(await this.rpc("confirm_notification_batch", {
      p_batch_id: id,
      p_confirmation_key: input.confirmationIdempotencyKey,
      p_acknowledged_count: input.acknowledgedRecipientCount,
      p_actor_id: actorId
    }));
  }

  async retryEvent(id: string, actorId: string) {
    return mapEvent(await this.rpc("retry_notification_event", { p_event_id: id, p_actor_id: actorId }));
  }

  async getPause() {
    const { data, error } = await this.client().from("system_settings").select("value,updated_at").eq("key", "reminders").single();
    if (error) databaseError(error);
    const row = asRow(data);
    const value = asRow(row.value);
    return { paused: Boolean(value.paused), updatedAt: text(row, "updated_at") };
  }

  async setPause(paused: boolean, expectedVersion: unknown, actorId: string) {
    const data = asRow(await this.rpc("set_reminder_pause", {
      p_paused: paused,
      p_expected_updated_at: expectedVersion,
      p_actor_id: actorId
    }));
    return { paused: booleanValue(data, "paused"), updatedAt: text(data, "updated_at") };
  }

  async getTestContacts(): Promise<TestContacts> {
    const { data, error } = await this.client()
      .from("system_settings")
      .select("value,updated_at")
      .eq("key", "notification_test_contacts")
      .single();
    if (error) databaseError(error);
    const row = asRow(data);
    const value = asRow(row.value);
    return {
      email: nullableText(value, "email"),
      phoneE164: nullableText(value, "phoneE164"),
      updatedAt: text(row, "updated_at")
    };
  }

  async setTestContacts(payload: unknown, actorId: string): Promise<TestContacts> {
    const input = testContactsInputSchema.parse(payload);
    const data = asRow(await this.rpc("set_notification_test_contacts", {
      p_email: input.email,
      p_phone_e164: input.phoneE164,
      p_expected_updated_at: input.expectedVersion,
      p_actor_id: actorId
    }));
    return {
      email: nullableText(data, "email"),
      phoneE164: nullableText(data, "phoneE164"),
      updatedAt: text(data, "updated_at")
    };
  }

  async createTestEvent(payload: unknown, actorId: string) {
    const input = testNotificationSchema.parse(payload);
    return mapEvent(await this.rpc("create_test_notification_event", {
      p_tenant_id: input.tenantId,
      p_channel: input.channel,
      p_template_id: input.templateId,
      p_request_id: input.requestId,
      p_actor_id: actorId
    }));
  }

  async applyProviderStatus(
    provider: "twilio" | "resend",
    providerMessageId: string,
    nextStatus: NotificationEvent["status"],
    providerStatus: string
  ) {
    return mapEvent(await this.rpc("apply_provider_status", {
      p_provider: provider,
      p_provider_message_id: providerMessageId,
      p_next_status: nextStatus,
      p_provider_status: providerStatus
    }));
  }

  async runReminderWorker() {
    const startedAt = Date.now();
    const materialized = asRow(await this.rpc("materialize_due_reminders", {
      p_now: new Date(startedAt).toISOString(),
      p_force_paused: process.env.REMINDERS_FORCE_PAUSED !== "false"
    }));
    if (materialized.status === "paused") return materialized;

    const runId = text(materialized, "id");
    const claimToken = crypto.randomUUID();
    const claimed = asRows(await this.rpc("claim_notification_events", {
      p_now: new Date().toISOString(),
      p_limit: 200,
      p_claim_token: claimToken
    }));
    const providerSet = createNotificationProviders(resolveNotificationProviderMode());
    let dispatched = 0;
    let failed = 0;

    for (let index = 0; index < claimed.length; index += 10) {
      if (Date.now() - startedAt >= 45_000) break;
      const chunk = claimed.slice(index, index + 10);
      const outcomes = await Promise.all(
        chunk.map((event) => this.processClaimedEvent(event, claimToken, providerSet))
      );
      dispatched += outcomes.filter((outcome) => outcome === "dispatched").length;
      failed += outcomes.filter((outcome) => outcome === "failed").length;
    }

    return this.rpc("finish_reminder_worker_run", {
      p_run_id: runId,
      p_dispatched: dispatched,
      p_failed: failed
    });
  }

  async claimOperationalAlert(code: string, bucketStart: string, message: string) {
    const { data, error } = await this.client()
      .from("operational_alert_deliveries")
      .insert({
        alert_code: code,
        bucket_start: bucketStart,
        message,
        status: "processing"
      })
      .select("id")
      .maybeSingle();
    if (error?.code === "23505") return null;
    if (error) databaseError(error);
    return data ? text(asRow(data), "id") : null;
  }

  async finishOperationalAlert(
    id: string,
    status: "sent" | "failed",
    providerMessageId: string | null,
    safeErrorCode: string | null
  ) {
    const { error } = await this.client()
      .from("operational_alert_deliveries")
      .update({
        status,
        provider_message_id: providerMessageId,
        safe_error_code: safeErrorCode,
        completed_at: new Date().toISOString()
      })
      .eq("id", id);
    if (error) databaseError(error);
  }

  async runDailyMaintenance() {
    return this.rpc("run_daily_maintenance", { p_now: new Date().toISOString() });
  }

  private async processClaimedEvent(
    claimedEvent: Row,
    claimToken: string,
    providerSet: ReturnType<typeof createNotificationProviders>
  ): Promise<"dispatched" | "failed" | "skipped"> {
    const eventId = text(claimedEvent, "id");
    const prepared = asRow(await this.rpc("begin_notification_attempt", {
      p_event_id: eventId,
      p_claim_token: claimToken
    }));
    if (prepared.status !== "processing") return "skipped";

    const channel = text(prepared, "channel");
    try {
      await this.rpc("mark_provider_request_started", {
        p_event_id: eventId,
        p_claim_token: claimToken
      });

      const result = channel === "email"
        ? await providerSet.email.send({
            to: text(prepared, "destination"),
            subject: nullableText(prepared, "rendered_subject") ?? "",
            html: plainTextToHtml(text(prepared, "rendered_body")),
            text: text(prepared, "rendered_body"),
            idempotencyKey: text(prepared, "occurrence_key")
          })
        : await providerSet.sms.send({
            to: text(prepared, "destination"),
            body: text(prepared, "rendered_body"),
            statusCallbackUrl: process.env.TWILIO_STATUS_CALLBACK_URL ?? `${process.env.APP_BASE_URL}/api/webhooks/twilio`
          });

      await this.rpc("complete_notification_attempt", {
        p_event_id: eventId,
        p_claim_token: claimToken,
        p_provider_message_id: result.providerMessageId,
        p_status: result.status,
        p_provider_status: result.providerStatus ?? result.status
      });
      return "dispatched";
    } catch (error) {
      const knownProviderRejection = error instanceof ApiError;
      const ambiguous = channel === "sms" && !knownProviderRejection;
      const retryable = channel === "email" && !knownProviderRejection;
      await this.rpc("fail_notification_attempt", {
        p_event_id: eventId,
        p_claim_token: claimToken,
        p_error_code: knownProviderRejection ? error.code : "PROVIDER_NETWORK_ERROR",
        p_retryable: retryable,
        p_ambiguous: ambiguous
      });
      return "failed";
    }
  }

  private async promoteMediaForPublish(ids: string[]) {
    if (ids.length === 0) return [];
    const client = this.client();
    const draftBucket = process.env.SUPABASE_STORAGE_DRAFT_BUCKET ?? "site-media-drafts";
    const publicBucket = process.env.SUPABASE_STORAGE_PUBLIC_BUCKET ?? "site-media";
    const { data, error } = await client
      .from("media_assets")
      .select("id,state,draft_storage_path,published_storage_path,public_url")
      .in("id", ids);
    if (error) databaseError(error);
    const assets = asRows(data);
    if (assets.length !== ids.length) {
      throw new ApiError(400, "MEDIA_NOT_FOUND", "One or more referenced media assets do not exist.");
    }

    const promoted: Array<{ id: string; path: string; url: string }> = [];
    for (const asset of assets) {
      const id = text(asset, "id");
      if (asset.state === "published") {
        promoted.push({
          id,
          path: text(asset, "published_storage_path"),
          url: text(asset, "public_url")
        });
        continue;
      }
      const draftPath = text(asset, "draft_storage_path");
      const extension = draftPath.split(".").at(-1) ?? "img";
      const publishedPath = `published/${id}/${id}.${extension}`;
      const { error: copyError } = await client.storage
        .from(draftBucket)
        .copy(draftPath, publishedPath, { destinationBucket: publicBucket });
      if (copyError && !copyError.message.toLocaleLowerCase().includes("already exists")) {
        throw new ApiError(502, "MEDIA_PROMOTION_FAILED", "A referenced image could not be published.");
      }
      const publicUrl = client.storage.from(publicBucket).getPublicUrl(publishedPath).data.publicUrl;
      promoted.push({ id, path: publishedPath, url: publicUrl });
    }
    return promoted;
  }
}

function plainTextToHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
    .replaceAll("\n", "<br>");
}
