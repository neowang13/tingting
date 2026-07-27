import {
  demoEvents,
  demoRentals,
  demoSchedules,
  demoSections,
  demoTemplates,
  demoTenants
} from "@/data/demo";
import { validateSection } from "@/features/content/schemas";
import { nextOccurrence } from "@/features/reminders/scheduler";
import {
  estimateSmsSegments,
  renderTemplate,
  type TemplateContext
} from "@/features/notifications/template-renderer";
import {
  createNotificationProviders,
  resolveNotificationProviderMode
} from "@/features/notifications/providers";
import {
  collectMediaAssetIds,
  getDemoMediaAsset,
  promoteDemoMedia,
  resolveDemoMedia
} from "@/features/content/media-service";
import { ApiError } from "@/lib/api";
import type {
  Channel,
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

interface MemoryState {
  sections: SiteSection[];
  revisions: SectionRevision[];
  rentals: RentalListing[];
  tenants: Tenant[];
  schedules: ReminderSchedule[];
  templates: NotificationTemplate[];
  events: NotificationEvent[];
  batches: NotificationBatch[];
  batchRecipients: FrozenBatchRecipient[];
  batchConfirmationKeys: Record<string, string>;
  eventPayloads: Record<string, { destination: string; subject: string | null; body: string }>;
  remindersPaused: boolean;
  settingsUpdatedAt: string;
  lastWorkerRunAt: string | null;
  lastWorkerStatus: string | null;
  testContacts: TestContacts;
}

interface FrozenBatchRecipient {
  batchId: string;
  tenantId: string;
  channel: Channel;
  eligible: boolean;
  skipReason: string | null;
  destination: string | null;
  destinationMasked: string | null;
  tenantVersion: string;
  templateId: string;
}

declare global {
  var __tingtingMemoryState: MemoryState | undefined;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function initialState(): MemoryState {
  return {
    sections: clone(demoSections),
    revisions: [],
    rentals: clone(demoRentals),
    tenants: clone(demoTenants),
    schedules: clone(demoSchedules),
    templates: clone(demoTemplates),
    events: clone(demoEvents),
    batches: [],
    batchRecipients: [],
    batchConfirmationKeys: {},
    eventPayloads: {},
    remindersPaused: true,
    settingsUpdatedAt: new Date().toISOString(),
    lastWorkerRunAt: null,
    lastWorkerStatus: null,
    testContacts: {
      email: null,
      phoneE164: null,
      updatedAt: new Date().toISOString()
    }
  };
}

function state() {
  if (process.env.DATA_BACKEND === "supabase") {
    throw new ApiError(
      503,
      "PERSISTENCE_ADAPTER_NOT_ACTIVATED",
      "The Supabase schema is ready, but the production repository adapter has not been activated in this framework milestone."
    );
  }
  globalThis.__tingtingMemoryState ??= initialState();
  return globalThis.__tingtingMemoryState;
}

function assertVersion(actual: string, expected: unknown) {
  if (typeof expected !== "string") {
    throw new ApiError(400, "EXPECTED_VERSION_REQUIRED", "expectedVersion is required.");
  }
  if (actual !== expected) {
    throw new ApiError(409, "VERSION_CONFLICT", "This record changed after it was loaded.", {
      currentVersion: actual
    });
  }
}

function findOr404<T extends { id: string }>(items: T[], id: string, label: string): T {
  const item = items.find((candidate) => candidate.id === id);
  if (!item) throw new ApiError(404, "NOT_FOUND", `${label} was not found.`);
  return item;
}

export const store = {
  reset() {
    globalThis.__tingtingMemoryState = initialState();
  },

  listSections() {
    return clone(state().sections);
  },

  getSection(key: SectionKey) {
    const section = state().sections.find((item) => item.key === key);
    if (!section) throw new ApiError(404, "NOT_FOUND", "Section was not found.");
    return clone(section);
  },

  listSectionRevisions(key: SectionKey) {
    return clone(
      state().revisions
        .filter((revision) => revision.sectionKey === key)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    );
  },

  saveSectionDraft(key: SectionKey, content: unknown, expectedVersion: unknown) {
    const section = state().sections.find((item) => item.key === key);
    if (!section) throw new ApiError(404, "NOT_FOUND", "Section was not found.");
    assertVersion(section.updatedAt, expectedVersion);
    section.draftContent = validateSection(key, content);
    section.updatedAt = new Date().toISOString();
    return clone(section);
  },

  publishSection(key: SectionKey, expectedVersion: unknown) {
    const section = state().sections.find((item) => item.key === key);
    if (!section) throw new ApiError(404, "NOT_FOUND", "Section was not found.");
    assertVersion(section.updatedAt, expectedVersion);
    const published = validateSection(key, section.draftContent);
    promoteDemoMedia(collectMediaAssetIds(published));
    const now = new Date().toISOString();
    state().revisions.push({
      id: crypto.randomUUID(),
      sectionKey: key,
      schemaVersion: section.schemaVersion,
      content: clone(published),
      createdAt: now
    });
    section.publishedContent = published;
    section.publishedAt = now;
    section.updatedAt = now;
    return clone(section);
  },

  rollbackSection(key: SectionKey, revisionId: unknown, expectedVersion: unknown) {
    const section = state().sections.find((item) => item.key === key);
    if (!section) throw new ApiError(404, "NOT_FOUND", "Section was not found.");
    assertVersion(section.updatedAt, expectedVersion);
    const revision = state().revisions.find((item) => item.id === revisionId && item.sectionKey === key);
    if (!revision) throw new ApiError(404, "NOT_FOUND", "Revision was not found.");
    const content = validateSection(key, revision.content);
    const now = new Date().toISOString();
    section.draftContent = clone(content);
    section.publishedContent = clone(content);
    section.publishedAt = now;
    section.updatedAt = now;
    state().revisions.push({
      id: crypto.randomUUID(),
      sectionKey: key,
      schemaVersion: section.schemaVersion,
      content: clone(content),
      createdAt: now
    });
    return clone(section);
  },

  listRentals(includePrivate = true) {
    const rentals = includePrivate
      ? state().rentals
      : state().rentals.filter((item) => item.status === "published");
    return clone(rentals.sort((a, b) => a.sortOrder - b.sortOrder));
  },

  getRental(id: string) {
    return clone(findOr404(state().rentals, id, "Rental"));
  },

  createRental(payload: unknown) {
    const input = rentalInputSchema.parse(payload);
    if (state().rentals.some((item) => item.slug === input.slug)) {
      throw new ApiError(409, "SLUG_CONFLICT", "A rental already uses this slug.");
    }
    const now = new Date().toISOString();
    const rental: RentalListing = {
      id: crypto.randomUUID(),
      ...input,
      images: input.images.map((image) => {
        const asset = getDemoMediaAsset(image.mediaAssetId);
        if (!asset) throw new ApiError(400, "MEDIA_NOT_FOUND", "A selected rental image was not found.");
        return { ...image, url: asset.previewUrl, alt: asset.altText };
      }),
      status: "draft",
      createdAt: now,
      updatedAt: now,
      publishedAt: null
    };
    state().rentals.push(rental);
    return clone(rental);
  },

  updateRental(id: string, payload: unknown, expectedVersion: unknown) {
    const rental = findOr404(state().rentals, id, "Rental");
    assertVersion(rental.updatedAt, expectedVersion);
    const input = rentalInputSchema.parse(payload);
    if (rental.publishedAt && input.slug !== rental.slug) {
      throw new ApiError(409, "SLUG_IMMUTABLE", "The rental URL cannot change after first publish.");
    }
    if (state().rentals.some((item) => item.id !== id && item.slug === input.slug)) {
      throw new ApiError(409, "SLUG_CONFLICT", "A rental already uses this slug.");
    }
    const images = input.images.map((image) => {
      const asset = getDemoMediaAsset(image.mediaAssetId);
      if (!asset) throw new ApiError(400, "MEDIA_NOT_FOUND", "A selected rental image was not found.");
      return { ...image, url: asset.previewUrl, alt: asset.altText };
    });
    Object.assign(rental, input, { images, updatedAt: new Date().toISOString() });
    return clone(rental);
  },

  setRentalStatus(id: string, action: "publish" | "unpublish" | "archive", expectedVersion: unknown) {
    const rental = findOr404(state().rentals, id, "Rental");
    assertVersion(rental.updatedAt, expectedVersion);
    const coverCount = rental.images.filter((image) => image.isCover).length;
    if (action === "publish" && coverCount !== 1 && !rental.coverImageUrl) {
      throw new ApiError(400, "COVER_IMAGE_REQUIRED", "Choose exactly one cover image before publishing.");
    }
    const now = new Date().toISOString();
    if (action === "publish" && rental.images.length > 0) {
      promoteDemoMedia(rental.images.map((image) => image.mediaAssetId));
      const cover = rental.images.find((image) => image.isCover);
      rental.coverImageUrl = cover ? resolveDemoMedia(cover.mediaAssetId) : rental.coverImageUrl;
      rental.images = rental.images.map((image) => ({
        ...image,
        url: resolveDemoMedia(image.mediaAssetId)
      }));
    }
    rental.status = action === "publish" ? "published" : action === "archive" ? "archived" : "draft";
    rental.publishedAt = action === "publish" ? now : rental.publishedAt;
    rental.updatedAt = now;
    return clone(rental);
  },

  listTenants() {
    return clone(state().tenants);
  },

  getTenant(id: string) {
    const tenant = findOr404(state().tenants, id, "Tenant");
    const schedule = state().schedules.find((item) => item.tenantId === id) ?? null;
    return clone({ tenant, schedule });
  },

  createTenant(payload: unknown) {
    const input = tenantInputSchema.parse(payload);
    const now = new Date().toISOString();
    const tenant: Tenant = {
      id: crypto.randomUUID(),
      ...input,
      archivedAt: null,
      createdAt: now,
      updatedAt: now
    };
    state().tenants.push(tenant);
    return clone(tenant);
  },

  updateTenant(id: string, payload: unknown, expectedVersion: unknown) {
    const tenant = findOr404(state().tenants, id, "Tenant");
    assertVersion(tenant.updatedAt, expectedVersion);
    const input = tenantInputSchema.parse(payload);
    Object.assign(tenant, input, { updatedAt: new Date().toISOString() });
    return clone(tenant);
  },

  archiveTenant(id: string, expectedVersion: unknown) {
    const tenant = findOr404(state().tenants, id, "Tenant");
    assertVersion(tenant.updatedAt, expectedVersion);
    const now = new Date().toISOString();
    tenant.archivedAt = now;
    tenant.isActive = false;
    tenant.updatedAt = now;
    const schedule = state().schedules.find((item) => item.tenantId === id);
    if (schedule) {
      schedule.isEnabled = false;
      schedule.nextRunAt = null;
      schedule.updatedAt = now;
    }
    return clone(tenant);
  },

  saveSchedule(tenantId: string, payload: unknown, expectedVersion: unknown) {
    const tenant = findOr404(state().tenants, tenantId, "Tenant");
    const input = scheduleInputSchema.parse(payload);
    if (input.isEnabled && (!tenant.isActive || tenant.archivedAt)) {
      throw new ApiError(400, "TENANT_INACTIVE", "An inactive tenant cannot have an enabled schedule.");
    }
    if (
      input.isEnabled &&
      input.channels.includes("email") &&
      (!tenant.email || tenant.emailContactStatus !== "allowed")
    ) {
      throw new ApiError(400, "EMAIL_NOT_ELIGIBLE", "Email must be present and allowed before enabling.");
    }
    if (
      input.isEnabled &&
      input.channels.includes("sms") &&
      (!tenant.phoneE164 || tenant.smsContactStatus !== "allowed")
    ) {
      throw new ApiError(400, "SMS_NOT_ELIGIBLE", "SMS must be present and allowed before enabling.");
    }
    if (input.channels.includes("email")) {
      const template = state().templates.find((item) => item.id === input.emailTemplateId);
      if (!template || template.channel !== "email" || !template.isActive) {
        throw new ApiError(400, "EMAIL_TEMPLATE_REQUIRED", "Select an active email template.");
      }
    }
    if (input.channels.includes("sms")) {
      const template = state().templates.find((item) => item.id === input.smsTemplateId);
      if (!template || template.channel !== "sms" || !template.isActive) {
        throw new ApiError(400, "SMS_TEMPLATE_REQUIRED", "Select an active SMS template.");
      }
    }
    const existing = state().schedules.find((item) => item.tenantId === tenantId);
    const now = new Date().toISOString();
    const nextRunAt = input.isEnabled
      ? nextOccurrence({
          dayOfMonth: input.dayOfMonth,
          localTime: input.localTime,
          timezone: input.timezone,
          afterInstant: now
        })
      : null;

    if (existing) {
      assertVersion(existing.updatedAt, expectedVersion);
      Object.assign(existing, input, { nextRunAt, updatedAt: now });
      return clone(existing);
    }

    if (expectedVersion !== null && expectedVersion !== undefined) {
      throw new ApiError(409, "VERSION_CONFLICT", "The schedule does not exist yet.");
    }
    const schedule: ReminderSchedule = {
      id: crypto.randomUUID(),
      tenantId,
      ...input,
      nextRunAt,
      lastProcessedAt: null,
      createdAt: now,
      updatedAt: now
    };
    state().schedules.push(schedule);
    return clone(schedule);
  },

  listTemplates() {
    return clone(state().templates);
  },

  createTemplate(payload: unknown) {
    const input = templateInputSchema.parse(payload);
    const now = new Date().toISOString();
    const template: NotificationTemplate = {
      id: crypto.randomUUID(),
      ...input,
      createdAt: now,
      updatedAt: now
    };
    state().templates.push(template);
    return clone(template);
  },

  updateTemplate(id: string, payload: unknown, expectedVersion: unknown) {
    const template = findOr404(state().templates, id, "Template");
    assertVersion(template.updatedAt, expectedVersion);
    Object.assign(template, templateInputSchema.parse(payload), { updatedAt: new Date().toISOString() });
    return clone(template);
  },

  listEvents() {
    return clone(state().events);
  },

  applyProviderStatus(
    provider: "twilio" | "resend",
    providerMessageId: string,
    nextStatus: NotificationEvent["status"],
    providerStatus: string
  ) {
    const event = state().events.find(
      (item) => item.provider === provider && item.providerMessageId === providerMessageId
    );
    if (!event) throw new ApiError(404, "EVENT_NOT_FOUND", "No notification event matches this provider message.");
    const terminal = new Set(["delivered", "undelivered", "failed", "skipped", "unknown", "expired", "cancelled"]);
    if (terminal.has(event.status)) return clone(event);
    event.status = nextStatus;
    event.providerStatus = providerStatus;
    event.updatedAt = new Date().toISOString();
    const tenant = state().tenants.find((item) => item.id === event.tenantId);
    if (tenant && provider === "resend" && providerStatus.includes("complain")) {
      tenant.emailContactStatus = "complained";
      tenant.emailContactStatusReason = "Permanent complaint feedback from email provider";
      tenant.emailContactStatusSource = "resend_webhook";
      tenant.contactPermissionUpdatedAt = new Date().toISOString();
      tenant.updatedAt = tenant.contactPermissionUpdatedAt;
    } else if (tenant && provider === "resend" && providerStatus.includes("bounce")) {
      tenant.emailContactStatus = "bounced";
      tenant.emailContactStatusReason = "Permanent bounce feedback from email provider";
      tenant.emailContactStatusSource = "resend_webhook";
      tenant.contactPermissionUpdatedAt = new Date().toISOString();
      tenant.updatedAt = tenant.contactPermissionUpdatedAt;
    } else if (tenant && provider === "twilio" && /:2161[01]$/.test(providerStatus)) {
      tenant.smsContactStatus = "opted_out";
      tenant.smsContactStatusReason = "Opt-out feedback from SMS provider";
      tenant.smsContactStatusSource = "twilio_webhook";
      tenant.contactPermissionUpdatedAt = new Date().toISOString();
      tenant.updatedAt = tenant.contactPermissionUpdatedAt;
    } else if (tenant && provider === "twilio" && /:(21211|21614)$/.test(providerStatus)) {
      tenant.smsContactStatus = "invalid";
      tenant.smsContactStatusReason = "Invalid destination feedback from SMS provider";
      tenant.smsContactStatusSource = "twilio_webhook";
      tenant.contactPermissionUpdatedAt = new Date().toISOString();
      tenant.updatedAt = tenant.contactPermissionUpdatedAt;
    }
    return clone(event);
  },

  previewNotification(payload: unknown) {
    const input = notificationPreviewSchema.parse(payload);
    const selected =
      input.selectionMode === "all_active"
        ? state().tenants.filter((tenant) => tenant.isActive && !tenant.archivedAt)
        : state().tenants.filter((tenant) => input.tenantIds.includes(tenant.id));

    const rows = selected.flatMap((tenant) =>
      input.channels.map((channel) => {
        const destination = channel === "email" ? tenant.email : tenant.phoneE164;
        const status = channel === "email" ? tenant.emailContactStatus : tenant.smsContactStatus;
        const eligible =
          tenant.isActive &&
          !tenant.archivedAt &&
          tenant.preferredChannels.includes(channel) &&
          status === "allowed" &&
          Boolean(destination);
        return {
          tenantId: tenant.id,
          tenantName: tenant.fullName,
          channel,
          eligible,
          reason: eligible ? null : "Channel is unavailable, not preferred, or not permitted.",
          destinationMasked: maskDestination(destination, channel)
        };
      })
    );

    const sampleTenant = selected[0];
    const samples = input.channels.flatMap((channel) => {
      if (!sampleTenant) return [];
      const templateId = channel === "email" ? input.emailTemplateId : input.smsTemplateId;
      const template = state().templates.find(
        (item) => item.id === templateId && item.channel === channel && item.isActive
      );
      if (!template) {
        throw new ApiError(400, "TEMPLATE_NOT_AVAILABLE", `Select an active ${channel} template.`);
      }
      const context = templateContext(sampleTenant);
      return [{
        channel,
        subject: template.subjectTemplate ? renderTemplate(template.subjectTemplate, context) : null,
        body: renderTemplate(template.bodyTemplate, context)
      }];
    });

    return {
      requestId: input.requestId,
      selectedCount: selected.length,
      eligibleCount: rows.filter((row) => row.eligible).length,
      eligibleByChannel: {
        email: rows.filter((row) => row.eligible && row.channel === "email").length,
        sms: rows.filter((row) => row.eligible && row.channel === "sms").length
      },
      skippedCount: rows.filter((row) => !row.eligible).length,
      rows,
      samples,
      smsSegmentEstimate: samples.find((sample) => sample.channel === "sms")
        ? estimateSmsSegments(samples.find((sample) => sample.channel === "sms")?.body ?? "")
        : 0
    };
  },

  createBatch(payload: unknown) {
    const preview = this.previewNotification(payload);
    const input = notificationPreviewSchema.parse(payload);
    const existing = state().batches.find((batch) => batch.requestId === input.requestId);
    if (existing) return clone(existing);
    const now = new Date();
    const batch: NotificationBatch = {
      id: crypto.randomUUID(),
      requestId: input.requestId,
      selectedCount: preview.selectedCount,
      eligibleCount: preview.eligibleCount,
      status: "draft",
      requestedChannels: input.channels,
      expiresAt: new Date(now.getTime() + 30 * 60_000).toISOString(),
      confirmedAt: null,
      createdAt: now.toISOString()
    };
    state().batches.push(batch);
    const previewRows = preview.rows;
    for (const row of previewRows) {
      const tenant = findOr404(state().tenants, row.tenantId, "Tenant");
      const templateId = row.channel === "email" ? input.emailTemplateId : input.smsTemplateId;
      if (!templateId) throw new ApiError(400, "TEMPLATE_REQUIRED", "A template is required.");
      state().batchRecipients.push({
        batchId: batch.id,
        tenantId: tenant.id,
        channel: row.channel,
        eligible: row.eligible,
        skipReason: row.reason,
        destination: row.channel === "email" ? tenant.email : tenant.phoneE164,
        destinationMasked: row.destinationMasked,
        tenantVersion: tenant.updatedAt,
        templateId
      });
    }
    return clone(batch);
  },

  confirmBatch(id: string, payload: unknown) {
    const input = batchConfirmSchema.parse(payload);
    const batch = findOr404(state().batches, id, "Batch");
    if (new Date(batch.expiresAt) <= new Date()) {
      batch.status = "expired";
      throw new ApiError(409, "BATCH_EXPIRED", "This preview expired. Create a new preview.");
    }
    if (input.acknowledgedRecipientCount !== batch.eligibleCount) {
      throw new ApiError(409, "RECIPIENT_COUNT_CHANGED", "The acknowledged count does not match the frozen preview.");
    }
    const existingBatchId = state().batchConfirmationKeys[input.confirmationIdempotencyKey];
    if (existingBatchId && existingBatchId !== batch.id) {
      throw new ApiError(409, "IDEMPOTENCY_KEY_REUSED", "This confirmation key was already used.");
    }
    if (batch.status !== "draft") {
      if (existingBatchId === batch.id) return clone(batch);
      throw new ApiError(409, "BATCH_ALREADY_CONFIRMED", "This batch was already confirmed.");
    }
    const recipients = state().batchRecipients.filter((recipient) => recipient.batchId === batch.id);
    for (const recipient of recipients.filter((item) => item.eligible)) {
      const tenant = findOr404(state().tenants, recipient.tenantId, "Tenant");
      const destination = recipient.channel === "email" ? tenant.email : tenant.phoneE164;
      const permission = recipient.channel === "email" ? tenant.emailContactStatus : tenant.smsContactStatus;
      if (
        tenant.updatedAt !== recipient.tenantVersion ||
        !tenant.isActive ||
        tenant.archivedAt ||
        destination !== recipient.destination ||
        permission !== "allowed" ||
        !tenant.preferredChannels.includes(recipient.channel)
      ) {
        throw new ApiError(409, "FROZEN_RECIPIENT_CHANGED", "Recipient eligibility changed. Create a new preview.");
      }
    }

    const now = new Date().toISOString();
    for (const recipient of recipients.filter((item) => item.eligible)) {
      const occurrenceKey = `manual:${batch.id}:${recipient.tenantId}:${recipient.channel}`;
      if (state().events.some((event) => event.occurrenceKey === occurrenceKey)) continue;
      const tenant = findOr404(state().tenants, recipient.tenantId, "Tenant");
      const template = findOr404(state().templates, recipient.templateId, "Template");
      const context = templateContext(tenant);
      const event: NotificationEvent = {
        id: crypto.randomUUID(),
        tenantId: tenant.id,
        source: "manual",
        channel: recipient.channel,
        occurrenceKey,
        occurrenceLocalDate: now.slice(0, 10),
        scheduledFor: now,
        status: "scheduled",
        destinationMasked: recipient.destinationMasked,
        provider: null,
        providerMessageId: null,
        providerStatus: null,
        attemptCount: 0,
        lastErrorCode: null,
        createdAt: now,
        updatedAt: now
      };
      state().events.push(event);
      state().eventPayloads[event.id] = {
        destination: recipient.destination ?? "",
        subject: template.subjectTemplate ? renderTemplate(template.subjectTemplate, context) : null,
        body: renderTemplate(template.bodyTemplate, context)
      };
    }
    batch.status = "confirmed";
    batch.confirmedAt = now;
    state().batchConfirmationKeys[input.confirmationIdempotencyKey] = batch.id;
    return clone(batch);
  },

  retryEvent(id: string) {
    const original = findOr404(state().events, id, "Notification event");
    if (!["failed", "undelivered", "unknown"].includes(original.status)) {
      throw new ApiError(409, "EVENT_NOT_RETRYABLE", "This event is not eligible for retry.");
    }
    const now = new Date().toISOString();
    const retry: NotificationEvent = {
      ...clone(original),
      id: crypto.randomUUID(),
      source: "retry",
      occurrenceKey: `retry:${original.id}:${original.attemptCount + 1}`,
      status: "scheduled",
      provider: null,
      providerMessageId: null,
      providerStatus: null,
      attemptCount: 0,
      lastErrorCode: null,
      createdAt: now,
      updatedAt: now
    };
    state().events.push(retry);
    const originalPayload = state().eventPayloads[original.id];
    if (originalPayload) state().eventPayloads[retry.id] = clone(originalPayload);
    return clone(retry);
  },

  getPause() {
    return { paused: state().remindersPaused, updatedAt: state().settingsUpdatedAt };
  },

  setPause(paused: boolean, expectedVersion: unknown) {
    assertVersion(state().settingsUpdatedAt, expectedVersion);
    state().remindersPaused = paused;
    state().settingsUpdatedAt = new Date().toISOString();
    return this.getPause();
  },

  getTestContacts() {
    return clone(state().testContacts);
  },

  setTestContacts(payload: unknown) {
    const input = testContactsInputSchema.parse(payload);
    assertVersion(state().testContacts.updatedAt, input.expectedVersion);
    state().testContacts = {
      email: input.email,
      phoneE164: input.phoneE164,
      updatedAt: new Date().toISOString()
    };
    return clone(state().testContacts);
  },

  createTestEvent(payload: unknown) {
    const input = testNotificationSchema.parse(payload);
    const tenant = findOr404(state().tenants, input.tenantId, "Tenant");
    const template = findOr404(state().templates, input.templateId, "Template");
    if (template.channel !== input.channel || !template.isActive) {
      throw new ApiError(400, "TEST_TEMPLATE_INVALID", "Select an active template for the requested channel.");
    }
    const destination = input.channel === "email" ? state().testContacts.email : state().testContacts.phoneE164;
    if (!destination) {
      throw new ApiError(400, "TEST_DESTINATION_NOT_CONFIGURED", "Configure the admin-owned test destination first.");
    }
    const occurrenceKey = `test:${input.requestId}:${input.channel}`;
    const existing = state().events.find((event) => event.occurrenceKey === occurrenceKey);
    if (existing) return clone(existing);
    const now = new Date().toISOString();
    const event: NotificationEvent = {
      id: crypto.randomUUID(),
      tenantId: tenant.id,
      source: "test",
      channel: input.channel,
      occurrenceKey,
      occurrenceLocalDate: now.slice(0, 10),
      scheduledFor: now,
      status: "scheduled",
      destinationMasked: maskDestination(destination, input.channel),
      provider: null,
      providerMessageId: null,
      providerStatus: null,
      attemptCount: 0,
      lastErrorCode: null,
      createdAt: now,
      updatedAt: now
    };
    state().events.push(event);
    const context = templateContext(tenant);
    state().eventPayloads[event.id] = {
      destination,
      subject: template.subjectTemplate ? renderTemplate(template.subjectTemplate, context) : null,
      body: renderTemplate(template.bodyTemplate, context)
    };
    return clone(event);
  },

  dashboard(): DashboardSummary {
    const now = Date.now();
    const inSevenDays = now + 7 * 24 * 60 * 60_000;
    const oldestEligible = state().events
      .filter((item) => item.status === "scheduled")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    const warnings: string[] = [];
    const lastWorkerRunAt = state().lastWorkerRunAt;
    if (!state().remindersPaused && (!lastWorkerRunAt || now - Date.parse(lastWorkerRunAt) > 15 * 60_000)) {
      warnings.push("The reminder worker has not completed within the last 15 minutes.");
    }
    if (oldestEligible && now - Date.parse(oldestEligible.createdAt) > 24 * 60 * 60_000) {
      warnings.push("The notification backlog contains work older than the 24-hour grace period.");
    }
    if (state().events.filter((item) => item.status === "failed").length >= 3) {
      warnings.push("Several provider attempts have failed. Review delivery history before retrying.");
    }
    return {
      activeTenants: state().tenants.filter((item) => item.isActive && !item.archivedAt).length,
      enabledSchedules: state().schedules.filter((item) => item.isEnabled).length,
      dueNextSevenDays: state().schedules.filter(
        (item) => item.nextRunAt && Date.parse(item.nextRunAt) >= now && Date.parse(item.nextRunAt) <= inSevenDays
      ).length,
      failedLastThirtyDays: state().events.filter((item) => ["failed", "undelivered"].includes(item.status)).length,
      outboxBacklog: state().events.filter((item) => item.status === "scheduled").length,
      remindersPaused: state().remindersPaused,
      lastWorkerRunAt: state().lastWorkerRunAt,
      latestWorkerStatus: state().lastWorkerStatus,
      oldestEligibleEventAt: oldestEligible?.createdAt ?? null,
      warnings
    };
  },

  async runReminderWorker() {
    const startedAt = new Date().toISOString();
    state().lastWorkerRunAt = startedAt;
    if (state().remindersPaused || process.env.REMINDERS_FORCE_PAUSED !== "false") {
      state().lastWorkerStatus = "paused";
      return {
        status: "paused",
        startedAt,
        occurrencesCreated: 0,
        eventsDispatched: 0,
        backlogRemaining: state().events.filter((event) => event.status === "scheduled").length
      };
    }

    let occurrencesCreated = 0;
    const now = new Date();
    const dueSchedules = state().schedules
      .filter((schedule) => schedule.isEnabled && schedule.nextRunAt && Date.parse(schedule.nextRunAt) <= now.getTime())
      .slice(0, 200);

    for (const schedule of dueSchedules) {
      const tenant = findOr404(state().tenants, schedule.tenantId, "Tenant");
      const occurrenceDate = localDate(schedule.nextRunAt ?? startedAt, schedule.timezone);
      const expired = now.getTime() - Date.parse(schedule.nextRunAt ?? startedAt) > 24 * 60 * 60_000;
      for (const channel of schedule.channels) {
        const occurrenceKey = `scheduled:${schedule.id}:${occurrenceDate}:${channel}`;
        if (state().events.some((event) => event.occurrenceKey === occurrenceKey)) continue;
        const destination = channel === "email" ? tenant.email : tenant.phoneE164;
        const permission = channel === "email" ? tenant.emailContactStatus : tenant.smsContactStatus;
        const templateId = channel === "email" ? schedule.emailTemplateId : schedule.smsTemplateId;
        const template = state().templates.find((item) => item.id === templateId);
        const eligible =
          tenant.isActive &&
          !tenant.archivedAt &&
          tenant.preferredChannels.includes(channel) &&
          permission === "allowed" &&
          Boolean(destination) &&
          Boolean(template?.isActive);
        const status: NotificationEvent["status"] = expired ? "expired" : eligible ? "scheduled" : "skipped";
        const event: NotificationEvent = {
          id: crypto.randomUUID(),
          tenantId: tenant.id,
          source: "scheduled",
          channel,
          occurrenceKey,
          occurrenceLocalDate: occurrenceDate,
          scheduledFor: schedule.nextRunAt ?? startedAt,
          status,
          destinationMasked: eligible ? maskDestination(destination, channel) : null,
          provider: null,
          providerMessageId: null,
          providerStatus: null,
          attemptCount: 0,
          lastErrorCode: expired ? "OCCURRENCE_EXPIRED" : eligible ? null : "CHANNEL_NOT_ELIGIBLE",
          createdAt: startedAt,
          updatedAt: startedAt
        };
        state().events.push(event);
        occurrencesCreated += 1;
        if (eligible && template && destination) {
          const context = templateContext(tenant);
          state().eventPayloads[event.id] = {
            destination,
            subject: template.subjectTemplate ? renderTemplate(template.subjectTemplate, context) : null,
            body: renderTemplate(template.bodyTemplate, context)
          };
        }
      }
      schedule.lastProcessedAt = startedAt;
      schedule.nextRunAt = nextOccurrence({
        dayOfMonth: schedule.dayOfMonth,
        localTime: schedule.localTime,
        timezone: schedule.timezone,
        afterInstant: startedAt
      });
      schedule.updatedAt = startedAt;
    }

    const providerSet = createNotificationProviders(resolveNotificationProviderMode());
    const queued = state().events.filter((event) => event.status === "scheduled").slice(0, 200);
    let eventsDispatched = 0;
    let eventsFailed = 0;
    for (let index = 0; index < queued.length; index += 10) {
      const chunk = queued.slice(index, index + 10);
      const results = await Promise.all(chunk.map(async (event) => {
        const tenant = findOr404(state().tenants, event.tenantId, "Tenant");
        const payload = state().eventPayloads[event.id];
        const permission = event.channel === "email" ? tenant.emailContactStatus : tenant.smsContactStatus;
        const currentDestination = event.channel === "email" ? tenant.email : tenant.phoneE164;
        if (
          !payload ||
          !tenant.isActive ||
          tenant.archivedAt ||
          permission !== "allowed" ||
          currentDestination !== payload.destination
        ) {
          event.status = "cancelled";
          event.lastErrorCode = "CHANNEL_NO_LONGER_ELIGIBLE";
          event.updatedAt = new Date().toISOString();
          return false;
        }
        event.status = "processing";
        event.attemptCount += 1;
        event.updatedAt = new Date().toISOString();
        try {
          const result = event.channel === "email"
            ? await providerSet.email.send({
                to: payload.destination,
                subject: payload.subject ?? "",
                html: payload.body.replaceAll("\n", "<br>"),
                text: payload.body,
                idempotencyKey: event.occurrenceKey
              })
            : await providerSet.sms.send({
                to: payload.destination,
                body: payload.body,
                statusCallbackUrl: "https://example.test/api/webhooks/twilio"
              });
          event.status = result.status;
          event.provider = providerSet.mode === "mock" ? "mock" : event.channel === "email" ? "resend" : "twilio";
          event.providerMessageId = result.providerMessageId;
          event.providerStatus = result.providerStatus ?? result.status;
          event.updatedAt = new Date().toISOString();
          return true;
        } catch (error) {
          event.status = event.channel === "sms" && !(error instanceof ApiError) ? "unknown" : "failed";
          event.lastErrorCode = error instanceof ApiError ? error.code : "PROVIDER_NETWORK_ERROR";
          event.updatedAt = new Date().toISOString();
          return false;
        }
      }));
      eventsDispatched += results.filter(Boolean).length;
      eventsFailed += results.filter((result) => !result).length;
    }

    state().lastWorkerStatus = eventsFailed > 0 ? "partial" : "completed";
    return {
      status: state().lastWorkerStatus,
      startedAt,
      occurrencesCreated,
      eventsDispatched,
      eventsFailed,
      backlogRemaining: state().events.filter((event) => event.status === "scheduled").length
    };
  }
};

function maskDestination(value: string | null, channel: Channel) {
  if (!value) return null;
  if (channel === "email") {
    const [name, domain] = value.split("@");
    return `${name.slice(0, 1)}***@${domain}`;
  }
  return `${value.slice(0, 3)}***${value.slice(-2)}`;
}

function templateContext(tenant: Tenant): TemplateContext {
  return {
    tenant_name: tenant.fullName,
    property: tenant.propertyLabel,
    unit: tenant.unitLabel ?? "",
    due_date: "the first of the month",
    business_name: "Ting Ting Xu Real Estate",
    business_phone: "604-872-6896",
    business_email: "info@tingtingxu.ca"
  };
}

function localDate(instant: string, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(instant));
}
