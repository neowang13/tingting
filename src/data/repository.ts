import { store } from "@/data/store";
import { SupabaseRepository } from "@/data/supabase-repository";
import { resolveDemoMedia } from "@/features/content/media-service";
import { resolveSeededPublicMedia } from "@/features/content/public-media";
import type {
  DashboardSummary,
  NotificationBatch,
  NotificationEvent,
  NotificationEventFilters,
  NotificationTemplate,
  OwnerNotificationDelivery,
  ReminderSchedule,
  ReminderSettings,
  RentalListing,
  SectionRevision,
  SectionKey,
  PublicSiteSection,
  SiteSection,
  Tenant,
  TenantActivitySummary,
  TenantListFilters,
  TestContacts
} from "@/lib/contracts";

export interface DataRepository {
  dashboard(): Promise<DashboardSummary>;
  listSections(): Promise<SiteSection[]>;
  listPublicSections(): Promise<PublicSiteSection[]>;
  getPublicSection(key: SectionKey): Promise<PublicSiteSection | null>;
  resolvePublicMedia(ids: string[]): Promise<Record<string, string | null>>;
  getSection(key: SectionKey): Promise<SiteSection>;
  listSectionRevisions(key: SectionKey): Promise<SectionRevision[]>;
  saveSectionDraft(key: SectionKey, content: unknown, expectedVersion: unknown, actorId: string): Promise<SiteSection>;
  publishSection(key: SectionKey, expectedVersion: unknown, actorId: string): Promise<SiteSection>;
  rollbackSection(
    key: SectionKey,
    revisionId: unknown,
    expectedVersion: unknown,
    actorId: string
  ): Promise<SiteSection>;
  listRentals(includePrivate?: boolean): Promise<RentalListing[]>;
  getPublicRentalBySlug(slug: string): Promise<RentalListing | null>;
  getRental(id: string): Promise<RentalListing>;
  createRental(payload: unknown, actorId: string): Promise<RentalListing>;
  updateRental(id: string, payload: unknown, expectedVersion: unknown, actorId: string): Promise<RentalListing>;
  setRentalStatus(
    id: string,
    action: "publish" | "unpublish" | "archive",
    expectedVersion: unknown,
    actorId: string
  ): Promise<RentalListing>;
  executeAutomationResourceConfirmation(input: {
    confirmationId: string;
    serviceAccountId: string;
    idempotencyKey: string;
    targetId: string;
    action: "rental.publish" | "rental.unpublish" | "rental.archive" | "schedule.enable" | "schedule.disable";
  }): Promise<unknown>;
  listTenants(filters?: TenantListFilters): Promise<Tenant[]>;
  getTenant(id: string): Promise<{ tenant: Tenant; schedule: ReminderSchedule | null }>;
  createTenant(payload: unknown, actorId: string): Promise<Tenant>;
  updateTenant(id: string, payload: unknown, expectedVersion: unknown, actorId: string): Promise<Tenant>;
  archiveTenant(id: string, expectedVersion: unknown, actorId: string): Promise<Tenant>;
  saveSchedule(
    tenantId: string,
    payload: unknown,
    expectedVersion: unknown,
    actorId: string
  ): Promise<ReminderSchedule>;
  listTemplates(): Promise<NotificationTemplate[]>;
  createTemplate(payload: unknown, actorId: string): Promise<NotificationTemplate>;
  updateTemplate(
    id: string,
    payload: unknown,
    expectedVersion: unknown,
    actorId: string
  ): Promise<NotificationTemplate>;
  listEvents(filters?: NotificationEventFilters): Promise<NotificationEvent[]>;
  previewNotification(payload: unknown): Promise<unknown>;
  createBatch(payload: unknown, actorId: string): Promise<NotificationBatch>;
  confirmBatch(id: string, payload: unknown, actorId: string): Promise<NotificationBatch>;
  retryEvent(id: string, actorId: string): Promise<NotificationEvent>;
  getPause(): Promise<ReminderSettings>;
  setPause(paused: boolean, expectedVersion: unknown, actorId: string): Promise<ReminderSettings>;
  saveBusinessName(businessName: string, expectedVersion: unknown, actorId: string): Promise<ReminderSettings>;
  saveReminderSettings(payload: unknown, actorId: string): Promise<ReminderSettings>;
  getTestContacts(): Promise<TestContacts>;
  setTestContacts(payload: unknown, actorId: string): Promise<TestContacts>;
  createTestEvent(payload: unknown, actorId: string): Promise<NotificationEvent>;
  applyProviderStatus(
    provider: "twilio" | "resend",
    providerMessageId: string,
    nextStatus: NotificationEvent["status"],
    providerStatus: string
  ): Promise<NotificationEvent>;
  claimOperationalAlert(code: string, bucketStart: string, message: string): Promise<string | null>;
  finishOperationalAlert(
    id: string,
    status: "sent" | "failed",
    providerMessageId: string | null,
    safeErrorCode: string | null
  ): Promise<void>;
  runDailyMaintenance(): Promise<unknown>;
  runReminderWorker(): Promise<unknown>;
  enqueueOwnerNotification(input: {
    notificationKey: string;
    kind: OwnerNotificationDelivery["kind"];
    tenantId: string | null;
    payload: Record<string, unknown>;
    scheduledFor: string;
  }): Promise<string>;
  claimOwnerNotifications(now: string, limit: number): Promise<OwnerNotificationDelivery[]>;
  finishOwnerNotification(
    id: string,
    input: {
      status: "sent" | "failed";
      providerMessageId: string | null;
      safeErrorCode: string | null;
      nextAttemptAt: string | null;
    }
  ): Promise<void>;
  tenantActivitySummary(input: {
    periodStart: string;
    periodEnd: string;
    todayStart: string;
    now: string;
  }): Promise<TenantActivitySummary>;
}

const memoryOperationalAlertBuckets = new Map<string, string>();
interface MemoryOwnerNotification extends OwnerNotificationDelivery {
  status: "scheduled" | "processing" | "sent" | "failed";
  scheduledFor: string;
  nextAttemptAt: string;
  providerMessageId: string | null;
  safeErrorCode: string | null;
  updatedAt: string;
}
const memoryOwnerNotifications = new Map<string, MemoryOwnerNotification>();

class MemoryRepository implements DataRepository {
  async dashboard() { return store.dashboard(); }
  async listSections() { return store.listSections(); }
  async listPublicSections() {
    return store.listSections().map(({ key, schemaVersion, publishedContent, publishedAt }) => ({
      key,
      schemaVersion,
      publishedContent,
      publishedAt
    }));
  }
  async getPublicSection(key: SectionKey) {
    const section = store.getSection(key);
    return {
      key: section.key,
      schemaVersion: section.schemaVersion,
      publishedContent: section.publishedContent,
      publishedAt: section.publishedAt
    };
  }
  async resolvePublicMedia(ids: string[]) {
    return Object.fromEntries(ids.map((id) => [id, resolveDemoMedia(id) ?? resolveSeededPublicMedia(id)]));
  }
  async getSection(key: SectionKey) { return store.getSection(key); }
  async listSectionRevisions(key: SectionKey) { return store.listSectionRevisions(key); }
  async saveSectionDraft(key: SectionKey, content: unknown, expectedVersion: unknown) {
    return store.saveSectionDraft(key, content, expectedVersion);
  }
  async publishSection(key: SectionKey, expectedVersion: unknown) {
    return store.publishSection(key, expectedVersion);
  }
  async rollbackSection(key: SectionKey, revisionId: unknown, expectedVersion: unknown) {
    return store.rollbackSection(key, revisionId, expectedVersion);
  }
  async listRentals(includePrivate = true) { return store.listRentals(includePrivate); }
  async getPublicRentalBySlug(slug: string) { return store.getPublicRentalBySlug(slug); }
  async getRental(id: string) { return store.getRental(id); }
  async createRental(payload: unknown) { return store.createRental(payload); }
  async updateRental(id: string, payload: unknown, expectedVersion: unknown) {
    return store.updateRental(id, payload, expectedVersion);
  }
  async setRentalStatus(id: string, action: "publish" | "unpublish" | "archive", expectedVersion: unknown) {
    return store.setRentalStatus(id, action, expectedVersion);
  }
  async executeAutomationResourceConfirmation() {
    throw new Error("Durable Automation confirmation execution is unavailable in memory mode.");
  }
  async listTenants(filters?: TenantListFilters) { return store.listTenants(filters); }
  async getTenant(id: string) { return store.getTenant(id); }
  async createTenant(payload: unknown) { return store.createTenant(payload); }
  async updateTenant(id: string, payload: unknown, expectedVersion: unknown) {
    return store.updateTenant(id, payload, expectedVersion);
  }
  async archiveTenant(id: string, expectedVersion: unknown) { return store.archiveTenant(id, expectedVersion); }
  async saveSchedule(tenantId: string, payload: unknown, expectedVersion: unknown) {
    return store.saveSchedule(tenantId, payload, expectedVersion);
  }
  async listTemplates() { return store.listTemplates(); }
  async createTemplate(payload: unknown) { return store.createTemplate(payload); }
  async updateTemplate(id: string, payload: unknown, expectedVersion: unknown) {
    return store.updateTemplate(id, payload, expectedVersion);
  }
  async listEvents(filters?: NotificationEventFilters) { return store.listEvents(filters); }
  async previewNotification(payload: unknown) { return store.previewNotification(payload); }
  async createBatch(payload: unknown) { return store.createBatch(payload); }
  async confirmBatch(id: string, payload: unknown) { return store.confirmBatch(id, payload); }
  async retryEvent(id: string) { return store.retryEvent(id); }
  async getPause() { return store.getPause(); }
  async setPause(paused: boolean, expectedVersion: unknown) { return store.setPause(paused, expectedVersion); }
  async saveBusinessName(businessName: string, expectedVersion: unknown) {
    return store.saveBusinessName(businessName, expectedVersion);
  }
  async saveReminderSettings(payload: unknown) { return store.saveReminderSettings(payload); }
  async getTestContacts() { return store.getTestContacts(); }
  async setTestContacts(payload: unknown) { return store.setTestContacts(payload); }
  async createTestEvent(payload: unknown) { return store.createTestEvent(payload); }
  async applyProviderStatus(
    provider: "twilio" | "resend",
    providerMessageId: string,
    nextStatus: NotificationEvent["status"],
    providerStatus: string
  ) {
    return store.applyProviderStatus(provider, providerMessageId, nextStatus, providerStatus);
  }
  async claimOperationalAlert(code: string, bucketStart: string) {
    const key = `${code}:${bucketStart}`;
    if (memoryOperationalAlertBuckets.has(key)) return null;
    const id = crypto.randomUUID();
    memoryOperationalAlertBuckets.set(key, id);
    return id;
  }
  async finishOperationalAlert() {}
  async runDailyMaintenance() {
    return {
      status: "completed",
      retention: {
        renderedEventsRedacted: 0,
        notificationEventsDeleted: 0,
        auditEventsDeleted: 0,
        contactSubmissionsDeleted: 0
      },
      reconciliation: { gapCount: 0, gaps: [] }
    };
  }
  async runReminderWorker() { return store.runReminderWorker(); }
  async enqueueOwnerNotification(input: {
    notificationKey: string;
    kind: OwnerNotificationDelivery["kind"];
    tenantId: string | null;
    payload: Record<string, unknown>;
    scheduledFor: string;
  }) {
    const existing = memoryOwnerNotifications.get(input.notificationKey);
    if (existing) return existing.id;
    const now = new Date().toISOString();
    const delivery: MemoryOwnerNotification = {
      id: crypto.randomUUID(),
      ...input,
      attemptCount: 0,
      status: "scheduled",
      nextAttemptAt: input.scheduledFor,
      providerMessageId: null,
      safeErrorCode: null,
      updatedAt: now
    };
    memoryOwnerNotifications.set(input.notificationKey, delivery);
    return delivery.id;
  }
  async claimOwnerNotifications(now: string, limit: number) {
    const claimBefore = Date.parse(now) - 10 * 60_000;
    const claimed = [...memoryOwnerNotifications.values()]
      .filter((delivery) => {
        if (delivery.attemptCount >= 5 || Date.parse(delivery.nextAttemptAt) > Date.parse(now)) {
          return false;
        }
        if (delivery.status === "scheduled" || delivery.status === "failed") return true;
        return delivery.status === "processing" && Date.parse(delivery.updatedAt) <= claimBefore;
      })
      .sort((left, right) => left.nextAttemptAt.localeCompare(right.nextAttemptAt))
      .slice(0, limit);
    for (const delivery of claimed) {
      delivery.status = "processing";
      delivery.attemptCount += 1;
      delivery.updatedAt = now;
    }
    return structuredClone(claimed);
  }
  async finishOwnerNotification(
    id: string,
    input: {
      status: "sent" | "failed";
      providerMessageId: string | null;
      safeErrorCode: string | null;
      nextAttemptAt: string | null;
    }
  ) {
    const delivery = [...memoryOwnerNotifications.values()].find((item) => item.id === id);
    if (!delivery) return;
    delivery.status = input.status;
    delivery.providerMessageId = input.providerMessageId;
    delivery.safeErrorCode = input.safeErrorCode;
    delivery.nextAttemptAt = input.nextAttemptAt ?? delivery.nextAttemptAt;
    delivery.updatedAt = new Date().toISOString();
  }
  async tenantActivitySummary(input: {
    periodStart: string;
    periodEnd: string;
    todayStart: string;
    now: string;
  }) {
    const tenants = store.listTenants({ limit: 500 });
    const periodNewTenants = tenants.filter(
      (tenant) => tenant.createdAt >= input.periodStart && tenant.createdAt < input.periodEnd
    );
    const todayNewTenants = tenants.filter(
      (tenant) => tenant.createdAt >= input.todayStart && tenant.createdAt <= input.now
    );
    return {
      activeCount: tenants.filter((tenant) => tenant.isActive && !tenant.archivedAt).length,
      periodNewCount: periodNewTenants.length,
      periodNewTenants,
      todayNewCount: todayNewTenants.length,
      todayNewTenants
    };
  }
}

let repository: DataRepository | undefined;

export function getRepository(): DataRepository {
  const useSupabase = process.env.DATA_BACKEND === "supabase";
  if (
    !repository ||
    (useSupabase && !(repository instanceof SupabaseRepository)) ||
    (!useSupabase && repository instanceof SupabaseRepository)
  ) {
    repository = useSupabase ? new SupabaseRepository() : new MemoryRepository();
  }
  return repository;
}

export function resetRepositoryForTests() {
  repository = undefined;
  memoryOperationalAlertBuckets.clear();
  memoryOwnerNotifications.clear();
}
