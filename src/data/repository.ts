import { store } from "@/data/store";
import { SupabaseRepository } from "@/data/supabase-repository";
import { resolveDemoMedia } from "@/features/content/media-service";
import { resolveSeededPublicMedia } from "@/features/content/public-media";
import {
  buildRentReportSnapshot,
  currentPaymentPeriod,
  isTenantLiableForPeriod,
  paymentPeriod,
  rentDueDateForPeriod,
  rentReportWindow,
  validateRentReceipt
} from "@/features/rent-payments/service";
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
  TenantRentPayment,
  TenantRentPaymentReceipt,
  RentReportSnapshot,
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
  materializeRentPeriods(businessDate: string): Promise<number>;
  getTenantRentPayment(tenantId: string, paymentPeriod: string): Promise<TenantRentPayment>;
  registerTenantRentReceipt(input: {
    tenantId: string;
    paymentPeriod: string;
    originalFilename: string;
    declaredMimeType: string;
    bytes: Uint8Array;
    actorType: "admin" | "automation";
    actorId: string;
  }): Promise<TenantRentPaymentReceipt>;
  markTenantRentCollected(input: {
    tenantId: string;
    paymentPeriod: string;
    receiptId: string;
    actorType: "admin" | "automation";
    actorId: string;
    collectedAt?: string | null;
    note?: string | null;
  }): Promise<TenantRentPayment & { alreadyCollected?: boolean }>;
  reopenTenantRentPayment(input: {
    tenantId: string;
    paymentPeriod: string;
    expectedVersion: string;
    actorId: string;
    reason?: string | null;
  }): Promise<TenantRentPayment>;
  tenantRentReceiptUrl(receiptId: string, actorId: string): Promise<string>;
  rentReportSnapshot(instant: string, timezone: string): Promise<RentReportSnapshot>;
  findTenantsForPayment(fullName: string, email: string): Promise<Tenant[]>;
  enqueueAgentNotification(input: {
    eventKey: string;
    kind: "weekly_report_sent" | "daily_overdue_rent_summary";
    payload: Record<string, unknown>;
    availableAt: string;
  }): Promise<string>;
  claimAgentNotification(serviceAccountId: string, now: string): Promise<Record<string, unknown> | null>;
  acknowledgeAgentNotification(
    eventId: string,
    serviceAccountId: string,
    now: string
  ): Promise<Record<string, unknown>>;
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
const memoryRentPayments = new Map<string, TenantRentPayment>();
const memoryRentReceipts = new Map<
  string,
  TenantRentPaymentReceipt & { tenantId: string; paymentPeriod: string; bytes: Uint8Array }
>();
const memoryAgentNotifications = new Map<string, {
  id: string;
  eventKey: string;
  kind: "weekly_report_sent" | "daily_overdue_rent_summary";
  payload: Record<string, unknown>;
  status: "pending" | "claimed" | "acknowledged";
  availableAt: string;
  claimedAt: string | null;
  claimedBy: string | null;
  acknowledgedAt: string | null;
}>();

function memoryPaymentKey(tenantId: string, period: string) {
  return `${tenantId}:${paymentPeriod(period)}`;
}

async function sha256(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer as ArrayBuffer);
  return `sha256:${Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0")
  ).join("")}`;
}

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
  async listTenants(filters: TenantListFilters = {}) {
    const period = currentPaymentPeriod();
    await this.materializeRentPeriods(period);
    return store.listTenants(filters)
      .map((tenant) => ({
        ...tenant,
        currentRentPayment: memoryRentPayments.get(memoryPaymentKey(tenant.id, period)) ?? null
      }))
      .filter((tenant) =>
        !filters.rentStatus || tenant.currentRentPayment?.status === filters.rentStatus
      )
      .filter((tenant) => {
        if (filters.leaseType === "needs_details") return tenant.leaseType === null;
        return !filters.leaseType || tenant.leaseType === filters.leaseType;
      });
  }
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
  async materializeRentPeriods(businessDate: string) {
    const period = currentPaymentPeriod(`${businessDate}T12:00:00.000Z`, "UTC");
    let inserted = 0;
    for (const tenant of store.listTenants({ limit: 500 })) {
      if (
        !tenant.isActive
        || tenant.archivedAt
        || !isTenantLiableForPeriod({
          leaseType: tenant.leaseType,
          moveInDate: tenant.moveInDate,
          leaseEndDate: tenant.leaseEndDate,
          period
        })
      ) continue;
      const key = memoryPaymentKey(tenant.id, period);
      if (memoryRentPayments.has(key)) continue;
      const now = new Date().toISOString();
      memoryRentPayments.set(key, {
        id: crypto.randomUUID(),
        tenantId: tenant.id,
        paymentPeriod: period,
        dueDate: rentDueDateForPeriod(period, tenant.rentDueDay),
        status: "due",
        receiptId: null,
        collectedAt: null,
        collectedByType: null,
        collectedById: null,
        note: null,
        createdAt: now,
        updatedAt: now
      });
      inserted += 1;
    }
    return inserted;
  }
  async getTenantRentPayment(tenantId: string, value: string) {
    const period = paymentPeriod(value);
    const key = memoryPaymentKey(tenantId, period);
    let result = memoryRentPayments.get(key);
    if (!result) {
      const { tenant } = store.getTenant(tenantId);
      const now = new Date().toISOString();
      result = {
        id: crypto.randomUUID(),
        tenantId,
        paymentPeriod: period,
        dueDate: rentDueDateForPeriod(period, tenant.rentDueDay),
        status: "due",
        receiptId: null,
        collectedAt: null,
        collectedByType: null,
        collectedById: null,
        note: null,
        createdAt: now,
        updatedAt: now
      };
      memoryRentPayments.set(key, result);
    }
    return structuredClone(result);
  }
  async registerTenantRentReceipt(input: {
    tenantId: string;
    paymentPeriod: string;
    originalFilename: string;
    declaredMimeType: string;
    bytes: Uint8Array;
    actorType: "admin" | "automation";
    actorId: string;
  }) {
    store.getTenant(input.tenantId);
    const period = paymentPeriod(input.paymentPeriod);
    const validated = validateRentReceipt(
      input.originalFilename,
      input.declaredMimeType,
      input.bytes
    );
    const digest = await sha256(input.bytes);
    const existing = [...memoryRentReceipts.values()].find((receipt) =>
      receipt.tenantId === input.tenantId
      && receipt.paymentPeriod === period
      && receipt.sha256Digest === digest
    );
    if (existing) return structuredClone(existing);
    const receipt = {
      id: crypto.randomUUID(),
      tenantId: input.tenantId,
      paymentPeriod: period,
      originalFilename: validated.originalFilename,
      mimeType: validated.mimeType,
      byteSize: validated.byteSize,
      sha256Digest: digest,
      bytes: input.bytes.slice(),
      createdAt: new Date().toISOString()
    };
    memoryRentReceipts.set(receipt.id, receipt);
    return structuredClone(receipt);
  }
  async markTenantRentCollected(input: {
    tenantId: string;
    paymentPeriod: string;
    receiptId: string;
    actorType: "admin" | "automation";
    actorId: string;
    collectedAt?: string | null;
    note?: string | null;
  }) {
    const period = paymentPeriod(input.paymentPeriod);
    const receipt = memoryRentReceipts.get(input.receiptId);
    if (
      !receipt
      || receipt.tenantId !== input.tenantId
      || receipt.paymentPeriod !== period
    ) {
      throw new Error("Receipt does not match the tenant and payment period.");
    }
    const current = await this.getTenantRentPayment(input.tenantId, period);
    if (current.status === "collected") return { ...current, alreadyCollected: true };
    const updated = {
      ...current,
      status: "collected" as const,
      receiptId: receipt.id,
      collectedAt: input.collectedAt ?? new Date().toISOString(),
      collectedByType: input.actorType,
      collectedById: input.actorId,
      note: input.note ?? null,
      updatedAt: new Date().toISOString()
    };
    memoryRentPayments.set(memoryPaymentKey(input.tenantId, period), updated);
    return structuredClone({ ...updated, alreadyCollected: false });
  }
  async reopenTenantRentPayment(input: {
    tenantId: string;
    paymentPeriod: string;
    expectedVersion: string;
    actorId: string;
    reason?: string | null;
  }) {
    const current = await this.getTenantRentPayment(input.tenantId, input.paymentPeriod);
    if (current.updatedAt !== input.expectedVersion) {
      throw new Error("Rent payment changed after it was loaded.");
    }
    const updated: TenantRentPayment = {
      ...current,
      status: "due",
      receiptId: null,
      collectedAt: null,
      collectedByType: null,
      collectedById: null,
      note: input.reason ?? null,
      updatedAt: new Date().toISOString()
    };
    memoryRentPayments.set(memoryPaymentKey(input.tenantId, input.paymentPeriod), updated);
    return structuredClone(updated);
  }
  async tenantRentReceiptUrl(receiptId: string) {
    if (!memoryRentReceipts.has(receiptId)) throw new Error("Receipt was not found.");
    return `memory://tenant-rent-payment-receipts/${receiptId}`;
  }
  async rentReportSnapshot(instant: string, timezone: string) {
    const window = rentReportWindow(instant, timezone);
    for (const value of [
      window.weekStart,
      window.weekEnd,
      window.nextWeekStart,
      window.nextWeekEnd
    ]) {
      await this.materializeRentPeriods(value);
    }
    return buildRentReportSnapshot({
      tenants: store.listTenants({ limit: 500 }),
      payments: [...memoryRentPayments.values()],
      instant,
      timezone
    });
  }
  async findTenantsForPayment(fullName: string, email: string) {
    const normalizedName = fullName.trim().toLocaleLowerCase("en-CA");
    const normalizedEmail = email.trim().toLocaleLowerCase("en-CA");
    return store.listTenants({ limit: 500 }).filter((tenant) =>
      tenant.fullName.trim().toLocaleLowerCase("en-CA") === normalizedName
      && tenant.email?.trim().toLocaleLowerCase("en-CA") === normalizedEmail
    );
  }
  async enqueueAgentNotification(input: {
    eventKey: string;
    kind: "weekly_report_sent" | "daily_overdue_rent_summary";
    payload: Record<string, unknown>;
    availableAt: string;
  }) {
    const existing = memoryAgentNotifications.get(input.eventKey);
    if (existing) return existing.id;
    const event = {
      id: crypto.randomUUID(),
      ...input,
      status: "pending" as const,
      claimedAt: null,
      claimedBy: null,
      acknowledgedAt: null
    };
    memoryAgentNotifications.set(input.eventKey, event);
    return event.id;
  }
  async claimAgentNotification(serviceAccountId: string, now: string) {
    const event = [...memoryAgentNotifications.values()]
      .filter((candidate) =>
        candidate.availableAt <= now
        && (
          candidate.status === "pending"
          || (
            candidate.status === "claimed"
            && candidate.claimedAt
            && Date.parse(candidate.claimedAt) <= Date.parse(now) - 10 * 60_000
          )
        )
      )
      .sort((left, right) => left.availableAt.localeCompare(right.availableAt))[0];
    if (!event) return null;
    event.status = "claimed";
    event.claimedAt = now;
    event.claimedBy = serviceAccountId;
    return structuredClone(event);
  }
  async acknowledgeAgentNotification(eventId: string, serviceAccountId: string, now: string) {
    const event = [...memoryAgentNotifications.values()].find((candidate) =>
      candidate.id === eventId
      && candidate.status === "claimed"
      && candidate.claimedBy === serviceAccountId
    );
    if (!event) throw new Error("Claimed Agent notification was not found.");
    event.status = "acknowledged";
    event.acknowledgedAt = now;
    return structuredClone(event);
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
  memoryRentPayments.clear();
  memoryRentReceipts.clear();
  memoryAgentNotifications.clear();
}
