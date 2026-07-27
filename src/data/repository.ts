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
  ReminderSchedule,
  RentalListing,
  SectionRevision,
  SectionKey,
  PublicSiteSection,
  SiteSection,
  Tenant,
  TenantListFilters,
  TestContacts
} from "@/lib/contracts";

export interface DataRepository {
  dashboard(): Promise<DashboardSummary>;
  listSections(): Promise<SiteSection[]>;
  listPublicSections(): Promise<PublicSiteSection[]>;
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
  getPause(): Promise<{ paused: boolean; updatedAt: string }>;
  setPause(paused: boolean, expectedVersion: unknown, actorId: string): Promise<{ paused: boolean; updatedAt: string }>;
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
}

const memoryOperationalAlertBuckets = new Map<string, string>();

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
}
