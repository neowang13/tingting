import {
  demoEvents,
  demoRentals,
  demoSchedules,
  demoSections,
  demoTemplates,
  demoTenants
} from "@/data/demo";
import { validateSection } from "@/features/content/schemas";
import {
  nextReminderOccurrence
} from "@/features/reminders/scheduler";
import {
  estimateSmsSegments,
  renderTemplate,
  type TemplateContext
} from "@/features/notifications/template-renderer";
import {
  formatRentDueDate,
  rentDueDateForOccurrence
} from "@/features/reminders/due-date";
import {
  createNotificationProviders,
  resolveNotificationProviderModes
} from "@/features/notifications/providers";
import {
  collectMediaAssetIds,
  getDemoMediaAsset,
  promoteDemoMedia,
  resolveDemoMedia
} from "@/features/content/media-service";
import {
  aggregateDigest,
  isRentalV2Payload,
  parseRentalPayload,
  rentalToV2,
  rentalV2Fields
} from "@/features/rentals/v2";
import { ApiError } from "@/lib/api";
import type {
  Channel,
  DashboardSummary,
  NotificationBatch,
  NotificationEvent,
  NotificationEventFilters,
  NotificationTemplate,
  ReminderSchedule,
  ReminderSettings,
  RentalListing,
  SectionRevision,
  SectionKey,
  SiteSection,
  Tenant,
  TenantListFilters,
  TestContacts
} from "@/lib/contracts";
import {
  batchConfirmSchema,
  businessNameSettingsInputSchema,
  notificationPreviewSchema,
  reminderSettingsInputSchema,
  publishRequirementPaths,
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
  rentalPublishedSnapshots: Record<string, RentalListing>;
  tenants: Tenant[];
  schedules: ReminderSchedule[];
  templates: NotificationTemplate[];
  events: NotificationEvent[];
  batches: NotificationBatch[];
  batchRecipients: FrozenBatchRecipient[];
  batchConfirmationKeys: Record<string, string>;
  eventPayloads: Record<string, { destination: string; subject: string | null; body: string }>;
  remindersPaused: boolean;
  reminderLeadDays: number;
  reminderLocalTime: string;
  reminderTimezone: string;
  reminderEmailTemplateId: string | null;
  businessName: string;
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
  const rentals = clone(demoRentals);
  return {
    sections: clone(demoSections),
    revisions: [],
    rentals,
    rentalPublishedSnapshots: Object.fromEntries(
      rentals
        .filter((rental) => rental.status === "published" && rental.publishedAt)
        .map((rental) => [rental.id, clone(rental)])
    ),
    tenants: clone(demoTenants),
    schedules: clone(demoSchedules),
    templates: clone(demoTemplates),
    events: clone(demoEvents),
    batches: [],
    batchRecipients: [],
    batchConfirmationKeys: {},
    eventPayloads: {},
    remindersPaused: true,
    reminderLeadDays: 3,
    reminderLocalTime: "09:00",
    reminderTimezone: "America/Vancouver",
    reminderEmailTemplateId: demoTemplates.find((template) => template.channel === "email")?.id ?? null,
    businessName: "Ting Ting Xu Real Estate",
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

function isEmailReminderEligible(tenant: Tenant) {
  return Boolean(
    tenant.isActive &&
    !tenant.archivedAt &&
    tenant.email &&
    tenant.emailContactStatus === "allowed"
  );
}

function calculateDerivedOccurrence(
  tenant: Tenant,
  afterInstant: string,
  catchUpBeforeDueDate = false
) {
  return nextReminderOccurrence({
    rentDueDay: tenant.rentDueDay,
    moveInDate: tenant.moveInDate,
    leadDays: state().reminderLeadDays,
    localTime: state().reminderLocalTime,
    timezone: state().reminderTimezone,
    afterInstant,
    catchUpBeforeDueDate
  });
}

function upsertDerivedSchedule(
  tenant: Tenant,
  now: string,
  options: { recompute: boolean; catchUpBeforeDueDate?: boolean } = { recompute: true }
) {
  const existing = state().schedules.find((item) => item.tenantId === tenant.id);
  const eligible = isEmailReminderEligible(tenant);
  const occurrence = eligible && options.recompute
    ? calculateDerivedOccurrence(tenant, now, options.catchUpBeforeDueDate)
    : null;

  if (existing) {
    existing.rentDueDay = tenant.rentDueDay;
    existing.dayOfMonth = occurrence
      ? Number(occurrence.sendLocalDate.slice(-2))
      : existing.dayOfMonth;
    existing.localTime = state().reminderLocalTime;
    existing.timezone = state().reminderTimezone;
    existing.channels = ["email"];
    existing.emailTemplateId = state().reminderEmailTemplateId;
    existing.smsTemplateId = null;
    existing.isEnabled = eligible;
    if (!eligible) existing.nextRunAt = null;
    else if (occurrence) existing.nextRunAt = occurrence.nextRunAt;
    existing.updatedAt = now;
    return existing;
  }

  const schedule: ReminderSchedule = {
    id: crypto.randomUUID(),
    tenantId: tenant.id,
    rentDueDay: tenant.rentDueDay,
    dayOfMonth: occurrence ? Number(occurrence.sendLocalDate.slice(-2)) : 1,
    localTime: state().reminderLocalTime,
    timezone: state().reminderTimezone,
    channels: ["email"],
    emailTemplateId: state().reminderEmailTemplateId,
    smsTemplateId: null,
    isEnabled: eligible,
    nextRunAt: occurrence?.nextRunAt ?? null,
    lastProcessedAt: null,
    createdAt: now,
    updatedAt: now
  };
  state().schedules.push(schedule);
  return schedule;
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
      : Object.values(state().rentalPublishedSnapshots);
    return clone(rentals.sort((a, b) => a.sortOrder - b.sortOrder));
  },

  getPublicRentalBySlug(slug: string) {
    const rental = Object.values(state().rentalPublishedSnapshots)
      .find((item) => item.slug === slug);
    return rental ? clone(rental) : null;
  },

  getRental(id: string) {
    return clone(findOr404(state().rentals, id, "Rental"));
  },

  createRental(payload: unknown) {
    const isV2 = isRentalV2Payload(payload);
    const { v2, legacy } = parseRentalPayload(payload);
    if (state().rentals.some((item) => item.slug === legacy.slug)) {
      throw new ApiError(409, "SLUG_CONFLICT", "A rental already uses this slug.");
    }
    const now = new Date().toISOString();
    const fields = rentalV2Fields(v2, now);
    const rental: RentalListing = {
      id: crypto.randomUUID(),
      ...fields,
      sortOrder: legacy.sortOrder,
      coverImageUrl: legacy.coverImageUrl,
      property: {
        ...fields.property,
        id: crypto.randomUUID()
      },
      images: legacy.images.map((image) => {
        const asset = getDemoMediaAsset(image.mediaAssetId);
        if (!asset) throw new ApiError(400, "MEDIA_NOT_FOUND", "A selected rental image was not found.");
        return { ...image, url: asset.previewUrl, alt: asset.altText };
      }),
      draftDigest: aggregateDigest(v2),
      publishedSourceDigest: null,
      reviewRequiredFields: isV2 ? [] : [
        "property.propertyType",
        "property.provinceCode",
        "property.postalCode",
        "availability.status",
        "layout.furnishedStatus",
        "availability.leaseType",
        "smokingPolicy",
        "pets.status"
      ],
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
    const isV2 = isRentalV2Payload(payload);
    const { v2, legacy } = parseRentalPayload(payload);
    if (rental.publishedAt && legacy.slug !== rental.slug) {
      throw new ApiError(409, "SLUG_IMMUTABLE", "The rental URL cannot change after first publish.");
    }
    if (state().rentals.some((item) => item.id !== id && item.slug === legacy.slug)) {
      throw new ApiError(409, "SLUG_CONFLICT", "A rental already uses this slug.");
    }
    if (
      isV2 &&
      rental.property?.updatedAt &&
      v2.property.expectedVersion !== rental.property.updatedAt
    ) {
      throw new ApiError(409, "VERSION_CONFLICT", "This property's address changed after it was loaded.");
    }
    const images = legacy.images.map((image) => {
      const asset = getDemoMediaAsset(image.mediaAssetId);
      if (!asset) throw new ApiError(400, "MEDIA_NOT_FOUND", "A selected rental image was not found.");
      return { ...image, url: asset.previewUrl, alt: asset.altText };
    });
    const now = new Date().toISOString();
    const fields = rentalV2Fields(v2, now);
    Object.assign(rental, fields, {
      property: {
        ...fields.property,
        id: rental.property?.id ?? v2.property.id ?? crypto.randomUUID()
      },
      sortOrder: rental.sortOrder,
      coverImageUrl: rental.coverImageUrl,
      images,
      draftDigest: aggregateDigest(v2),
      reviewRequiredFields: isV2 ? [] : rental.reviewRequiredFields,
      updatedAt: now
    });
    return clone(rental);
  },

  setRentalStatus(id: string, action: "publish" | "unpublish" | "archive", expectedVersion: unknown) {
    const rental = findOr404(state().rentals, id, "Rental");
    assertVersion(rental.updatedAt, expectedVersion);
    const coverCount = rental.images.filter((image) => image.isCover).length;
    if (action === "publish" && rental.draftDigest) {
      const missing = [
        ...publishRequirementPaths(rentalToV2(rental)),
        ...(rental.reviewRequiredFields ?? [])
      ];
      if (missing.length > 0) {
        throw new ApiError(400, "PUBLISH_REQUIREMENTS_MISSING", "Complete the listing before publishing.", {
          fields: [...new Set(missing)]
        });
      }
    }
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
    if (action === "publish") {
      rental.publishedSourceDigest = rental.draftDigest ?? rental.publishedSourceDigest ?? null;
      state().rentalPublishedSnapshots[rental.id] = clone(rental);
    } else {
      delete state().rentalPublishedSnapshots[rental.id];
    }
    return clone(rental);
  },

  listTenants(filters: TenantListFilters = {}) {
    const query = filters.query?.trim().toLocaleLowerCase();
    const projected = state().tenants.map((tenant) => {
      const schedule = state().schedules.find((item) => item.tenantId === tenant.id);
      const lastDelivery = state().events
        .filter((event) => event.tenantId === tenant.id)
        .sort((a, b) => b.scheduledFor.localeCompare(a.scheduledFor))[0];
      return {
        ...tenant,
        scheduleStatus: schedule ? (schedule.isEnabled ? "enabled" as const : "disabled" as const) : "missing" as const,
        nextRunAt: schedule?.nextRunAt ?? null,
        lastDeliveryStatus: lastDelivery?.status ?? null,
        lastDeliveryAt: lastDelivery?.scheduledFor ?? null
      };
    });
    return clone(projected
      .filter((tenant) => !query || [tenant.fullName, tenant.propertyLabel, tenant.unitLabel ?? ""]
        .some((value) => value.toLocaleLowerCase().includes(query)))
      .filter((tenant) => {
        if (filters.lifecycle === "active") return tenant.isActive && !tenant.archivedAt;
        if (filters.lifecycle === "inactive") return !tenant.isActive && !tenant.archivedAt;
        if (filters.lifecycle === "archived") return Boolean(tenant.archivedAt);
        return true;
      })
      .filter((tenant) => {
        if (filters.contact === "email_allowed") return tenant.emailContactStatus === "allowed";
        if (filters.contact === "email_blocked") return tenant.emailContactStatus !== "allowed";
        if (filters.contact === "sms_allowed") return tenant.smsContactStatus === "allowed";
        if (filters.contact === "sms_blocked") return tenant.smsContactStatus !== "allowed";
        return true;
      })
      .filter((tenant) => !filters.schedule || tenant.scheduleStatus === filters.schedule)
      .sort((a, b) => a.fullName.localeCompare(b.fullName))
      .slice(0, filters.limit ?? 500));
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
      moveInDate: input.moveInDate ?? null,
      archivedAt: null,
      createdAt: now,
      updatedAt: now
    };
    state().tenants.push(tenant);
    upsertDerivedSchedule(tenant, now, {
      recompute: true,
      catchUpBeforeDueDate: true
    });
    return clone(tenant);
  },

  updateTenant(id: string, payload: unknown, expectedVersion: unknown) {
    const tenant = findOr404(state().tenants, id, "Tenant");
    assertVersion(tenant.updatedAt, expectedVersion);
    const input = tenantInputSchema.parse(payload);
    const previousDueDay = tenant.rentDueDay;
    const wasEligible = isEmailReminderEligible(tenant);
    const now = new Date().toISOString();
    Object.assign(tenant, input, { updatedAt: now });
    const isEligible = isEmailReminderEligible(tenant);
    upsertDerivedSchedule(tenant, now, {
      recompute: previousDueDay !== tenant.rentDueDay || (!wasEligible && isEligible),
      catchUpBeforeDueDate: !wasEligible && isEligible
    });
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
    findOr404(state().tenants, tenantId, "Tenant");
    scheduleInputSchema.parse(payload);
    void expectedVersion;
    throw new ApiError(
      409,
      "GLOBAL_REMINDER_POLICY",
      "Per-tenant reminder schedules are read-only. Update the payment due date on the tenant or the global Reminder settings."
    );
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

  listEvents(filters: NotificationEventFilters = {}) {
    return clone(state().events
      .filter((event) => !filters.tenantId || event.tenantId === filters.tenantId)
      .filter((event) => !filters.channel || event.channel === filters.channel)
      .filter((event) => !filters.status || event.status === filters.status)
      .filter((event) => !filters.scheduledFrom || event.scheduledFor >= filters.scheduledFrom)
      .filter((event) => !filters.scheduledTo || event.scheduledFor <= filters.scheduledTo)
      .sort((a, b) => b.scheduledFor.localeCompare(a.scheduledFor))
      .slice(0, filters.limit ?? 500));
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
      const context = templateContext(
        sampleTenant,
        dueDateForTenant(sampleTenant.id, new Date().toISOString())
      );
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
      const context = templateContext(tenant, dueDateForTenant(tenant.id, now));
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
    return {
      businessName: state().businessName,
      paused: state().remindersPaused,
      leadDays: state().reminderLeadDays,
      localTime: state().reminderLocalTime,
      timezone: state().reminderTimezone,
      emailTemplateId: state().reminderEmailTemplateId,
      updatedAt: state().settingsUpdatedAt
    } satisfies ReminderSettings;
  },

  setPause(paused: boolean, expectedVersion: unknown) {
    assertVersion(state().settingsUpdatedAt, expectedVersion);
    state().remindersPaused = paused;
    state().settingsUpdatedAt = new Date().toISOString();
    return this.getPause();
  },

  saveBusinessName(businessName: string, expectedVersion: unknown) {
    const input = businessNameSettingsInputSchema.parse({ businessName, expectedVersion });
    assertVersion(state().settingsUpdatedAt, input.expectedVersion);
    state().businessName = input.businessName;
    state().settingsUpdatedAt = new Date().toISOString();
    return this.getPause();
  },

  saveReminderSettings(payload: unknown) {
    const input = reminderSettingsInputSchema.parse(payload);
    assertVersion(state().settingsUpdatedAt, input.expectedVersion);
    const template = state().templates.find((item) => item.id === input.emailTemplateId);
    if (!template || template.channel !== "email" || !template.isActive) {
      throw new ApiError(
        400,
        "EMAIL_TEMPLATE_REQUIRED",
        "Choose an active email template with a current revision."
      );
    }

    const timingChanged =
      input.leadDays !== state().reminderLeadDays ||
      input.localTime !== state().reminderLocalTime ||
      input.timezone !== state().reminderTimezone;
    const now = new Date().toISOString();
    let recalculatedTenants = 0;
    let preservedDueTenants = 0;

    state().remindersPaused = input.paused;
    state().reminderLeadDays = input.leadDays;
    state().reminderLocalTime = input.localTime;
    state().reminderTimezone = input.timezone;
    state().reminderEmailTemplateId = input.emailTemplateId;

    for (const tenant of state().tenants) {
      const schedule = state().schedules.find((item) => item.tenantId === tenant.id);
      if (timingChanged && schedule?.nextRunAt && Date.parse(schedule.nextRunAt) <= Date.parse(now)) {
        preservedDueTenants += 1;
        schedule.localTime = input.localTime;
        schedule.timezone = input.timezone;
        schedule.emailTemplateId = input.emailTemplateId;
        schedule.updatedAt = now;
        continue;
      }
      const derived = upsertDerivedSchedule(tenant, now, {
        recompute: timingChanged && isEmailReminderEligible(tenant)
      });
      derived.emailTemplateId = input.emailTemplateId;
      derived.localTime = input.localTime;
      derived.timezone = input.timezone;
      if (timingChanged && isEmailReminderEligible(tenant)) recalculatedTenants += 1;
    }

    state().settingsUpdatedAt = now;
    return {
      ...this.getPause(),
      recalculatedTenants,
      preservedDueTenants
    } satisfies ReminderSettings;
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
    const configuredDestination = input.channel === "email"
      ? state().testContacts.email
      : state().testContacts.phoneE164;
    const destination = input.destination ?? configuredDestination;
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
    const context = templateContext(
      tenant,
      input.dueDate
        ? formatRentDueDate(input.dueDate)
        : dueDateForTenant(tenant.id, now)
    );
    state().eventPayloads[event.id] = {
      destination,
      subject: input.renderedSubject !== undefined
        ? input.renderedSubject
        : template.subjectTemplate
          ? renderTemplate(template.subjectTemplate, context)
          : null,
      body: input.renderedBody ?? renderTemplate(template.bodyTemplate, context)
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
      const plannedFor = schedule.nextRunAt ?? startedAt;
      const occurrence = nextReminderOccurrence({
        rentDueDay: tenant.rentDueDay,
        moveInDate: tenant.moveInDate,
        leadDays: state().reminderLeadDays,
        localTime: state().reminderLocalTime,
        timezone: state().reminderTimezone,
        afterInstant: new Date(Date.parse(plannedFor) - 1).toISOString()
      });
      const occurrenceDate = occurrence.sendLocalDate;
      const expired = now.getTime() - Date.parse(schedule.nextRunAt ?? startedAt) > 24 * 60 * 60_000;
      for (const channel of ["email"] as const) {
        const occurrenceKey = `scheduled:${schedule.id}:${occurrenceDate}:${channel}`;
        if (state().events.some((event) => event.occurrenceKey === occurrenceKey)) continue;
        const destination = tenant.email;
        const permission = tenant.emailContactStatus;
        const templateId = state().reminderEmailTemplateId;
        const template = state().templates.find((item) => item.id === templateId);
        const eligible =
          tenant.isActive &&
          !tenant.archivedAt &&
          permission === "allowed" &&
          Boolean(destination) &&
          template?.channel === "email" &&
          Boolean(template.isActive);
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
          const context = templateContext(
            tenant,
            formatRentDueDate(occurrence.dueDate)
          );
          state().eventPayloads[event.id] = {
            destination,
            subject: template.subjectTemplate ? renderTemplate(template.subjectTemplate, context) : null,
            body: renderTemplate(template.bodyTemplate, context)
          };
        }
      }
      schedule.lastProcessedAt = startedAt;
      const next = nextReminderOccurrence({
        rentDueDay: tenant.rentDueDay,
        moveInDate: tenant.moveInDate,
        leadDays: state().reminderLeadDays,
        localTime: state().reminderLocalTime,
        timezone: state().reminderTimezone,
        afterInstant: startedAt
      });
      schedule.nextRunAt = next.nextRunAt;
      schedule.dayOfMonth = Number(next.sendLocalDate.slice(-2));
      schedule.localTime = state().reminderLocalTime;
      schedule.timezone = state().reminderTimezone;
      schedule.emailTemplateId = state().reminderEmailTemplateId;
      schedule.updatedAt = startedAt;
    }

    const providerSet = createNotificationProviders(resolveNotificationProviderModes());
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
          const providerMode = event.channel === "email"
            ? providerSet.emailMode
            : providerSet.smsMode;
          event.provider = providerMode === "mock"
            ? "mock"
            : event.channel === "email"
              ? "resend"
              : "twilio";
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

function templateContext(tenant: Tenant, dueDate: string): TemplateContext {
  return {
    tenant_name: tenant.fullName,
    property: tenant.propertyLabel,
    unit: tenant.unitLabel ?? "",
    due_date: dueDate,
    business_name: state().businessName,
    business_phone: "604-872-6896",
    business_email: "info@tingtingxu.ca"
  };
}

function dueDateForTenant(tenantId: string, instant: string) {
  const tenant = findOr404(state().tenants, tenantId, "Tenant");
  const schedule = state().schedules.find((item) => item.tenantId === tenantId);
  const occurrenceLocalDate = localDate(instant, tenant.timezone);
  return formatRentDueDate(
    rentDueDateForOccurrence(occurrenceLocalDate, schedule?.rentDueDay ?? 1)
  );
}

function localDate(instant: string, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(instant));
}
