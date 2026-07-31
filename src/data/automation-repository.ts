import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getRepository } from "@/data/repository";
import {
  generateAutomationToken,
  type AutomationTokenLookup
} from "@/features/automation/auth";
import {
  createConfirmationDigest,
  sha256Digest
} from "@/features/automation/confirmations";
import type {
  AutomationActor,
  AutomationConfirmationAction,
  AutomationConfirmationIntent,
  AutomationHealth,
  AutomationRental,
  AutomationScope,
  AutomationServiceAccount,
  AutomationTenant,
  TenantImportBatch,
  TenantImportOutcome,
  TenantImportRow
} from "@/features/automation/contracts";
import type {
  IdempotencyRecord,
  IdempotencyStore
} from "@/features/automation/idempotency";
import { parseTenantImportFile } from "@/features/automation/imports/file-parser";
import { detectWithinFileDuplicates, matchTenantImportRow } from "@/features/automation/imports/matcher";
import { normalizeTenantImportRow } from "@/features/automation/imports/normalizer";
import { createSanitizedImportErrorCsv } from "@/features/automation/imports/report-export";
import { redactValue } from "@/features/automation/redaction";
import {
  automationRentalInputSchema,
  automationTenantInputSchema
} from "@/features/automation/schemas";
import { uploadMediaAsset } from "@/features/content/media-service";
import { nextOccurrence } from "@/features/reminders/scheduler";
import { maskEmail, maskPhone } from "@/features/tenants/contact-utils";
import { ApiError } from "@/lib/api";
import type { ReminderSchedule, Tenant } from "@/lib/contracts";
import { readServerEnvironment } from "@/lib/env";

interface MemoryToken {
  id: string;
  prefix: string;
  tokenHash: string;
  isActive: boolean;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  serviceAccountId: string;
}

interface MemoryAutomationState {
  accounts: AutomationServiceAccount[];
  tokens: MemoryToken[];
  idempotency: Map<string, IdempotencyRecord>;
  confirmations: AutomationConfirmationIntent[];
  imports: TenantImportBatch[];
  externalRentals: Map<string, { sourceSystem: string | null; externalReference: string | null }>;
  externalTenants: Map<string, { sourceSystem: string | null; externalReference: string | null }>;
  audit: Array<Record<string, unknown>>;
}

declare global {
  var __tingtingAutomationMemory: MemoryAutomationState | undefined;
}

function memoryState(): MemoryAutomationState {
  globalThis.__tingtingAutomationMemory ??= {
    accounts: [],
    tokens: [],
    idempotency: new Map(),
    confirmations: [],
    imports: [],
    externalRentals: new Map(),
    externalTenants: new Map(),
    audit: []
  };
  return globalThis.__tingtingAutomationMemory;
}

function automationPepper() {
  const configured = process.env.AUTOMATION_TOKEN_PEPPER;
  if (configured) return configured;
  if (
    process.env.DATA_BACKEND === "supabase" ||
    process.env.NEXT_PUBLIC_APP_MODE === "production"
  ) {
    throw new ApiError(503, "AUTOMATION_TOKEN_PEPPER_REQUIRED", "Automation authentication is not configured.");
  }
  return "local-demo-only-automation-pepper-not-for-production";
}

function assertSupabaseConfiguration() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new ApiError(503, "SUPABASE_NOT_CONFIGURED", "Supabase persistence is not configured.");
  }
  return { url, key };
}

function dbError(error: { code?: string; message: string } | null): never {
  const conflict = error?.code === "23505" || error?.code === "TT409";
  throw new ApiError(
    conflict ? 409 : 500,
    conflict ? "VERSION_CONFLICT" : "DATABASE_ERROR",
    conflict
      ? "This record changed or conflicts with an existing record. Refresh before trying again."
      : "We could not save this change because the database is unavailable. Nothing after the last confirmed save was applied. Try again."
  );
}

function tokenPublic(token: MemoryToken) {
  return {
    id: token.id,
    prefix: token.prefix,
    isActive: token.isActive,
    expiresAt: token.expiresAt,
    lastUsedAt: token.lastUsedAt,
    revokedAt: token.revokedAt,
    createdAt: token.createdAt
  };
}

function cursorPage<T extends { id: string; updatedAt?: string; createdAt?: string }>(
  items: T[],
  limit: number,
  cursor?: string
) {
  const start = cursor
    ? Math.max(0, items.findIndex((item) => item.id === decodeCursor(cursor)) + 1)
    : 0;
  const data = items.slice(start, start + limit);
  const nextCursor = start + limit < items.length && data.length > 0
    ? encodeCursor(data[data.length - 1].id)
    : null;
  return { items: data, nextCursor };
}

function encodeCursor(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeCursor(value: string) {
  try {
    return Buffer.from(value, "base64url").toString("utf8");
  } catch {
    throw new ApiError(422, "VALIDATION_ERROR", "The cursor is invalid.");
  }
}

export class AutomationRepository implements IdempotencyStore {
  private clientInstance?: SupabaseClient;

  private isDurable() {
    return process.env.DATA_BACKEND === "supabase";
  }

  private client() {
    if (!this.clientInstance) {
      const { url, key } = assertSupabaseConfiguration();
      this.clientInstance = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false }
      });
    }
    return this.clientInstance;
  }

  async lookupToken(prefix: string): Promise<AutomationTokenLookup | null> {
    if (!this.isDurable()) {
      const token = memoryState().tokens.find((item) => item.prefix === prefix);
      if (!token) return null;
      const account = memoryState().accounts.find((item) => item.id === token.serviceAccountId);
      if (!account) return null;
      token.lastUsedAt = new Date().toISOString();
      return {
        id: token.id,
        prefix: token.prefix,
        tokenHash: token.tokenHash,
        isActive: token.isActive,
        expiresAt: token.expiresAt,
        revokedAt: token.revokedAt,
        serviceAccount: {
          id: account.id,
          name: account.name,
          delegatedAdminUserId: account.delegatedAdminUserId,
          delegatedAdminActive: true,
          scopes: account.scopes,
          isActive: account.isActive,
          expiresAt: account.expiresAt
        }
      };
    }
    const { data, error } = await this.client()
      .from("automation_service_account_tokens")
      .select("id,token_prefix,token_hash,is_active,expires_at,revoked_at,service_account_id,automation_service_accounts!inner(id,name,delegated_admin_user_id,scopes,is_active,expires_at,admin_profiles!automation_service_accounts_delegated_admin_user_id_fkey!inner(is_active))")
      .eq("token_prefix", prefix)
      .maybeSingle();
    if (error) dbError(error);
    if (!data) return null;
    const accountRaw = data.automation_service_accounts as unknown;
    const account = (Array.isArray(accountRaw) ? accountRaw[0] : accountRaw) as Record<string, unknown>;
    const profileRaw = account.admin_profiles as unknown;
    const profile = (Array.isArray(profileRaw) ? profileRaw[0] : profileRaw) as Record<string, unknown>;
    void this.client()
      .from("automation_service_account_tokens")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", data.id);
    return {
      id: data.id,
      prefix: data.token_prefix,
      tokenHash: data.token_hash,
      isActive: data.is_active,
      expiresAt: data.expires_at,
      revokedAt: data.revoked_at,
      serviceAccount: {
        id: String(account.id),
        name: String(account.name),
        delegatedAdminUserId: String(account.delegated_admin_user_id),
        delegatedAdminActive: Boolean(profile.is_active),
        scopes: account.scopes as AutomationScope[],
        isActive: Boolean(account.is_active),
        expiresAt: account.expires_at ? String(account.expires_at) : null
      }
    };
  }

  async listServiceAccounts(): Promise<AutomationServiceAccount[]> {
    if (!this.isDurable()) return structuredClone(memoryState().accounts);
    const { data, error } = await this.client()
      .from("automation_service_accounts")
      .select("id,name,delegated_admin_user_id,scopes,is_active,expires_at,created_at,updated_at,admin_profiles!automation_service_accounts_delegated_admin_user_id_fkey(display_name),automation_service_account_tokens(id,token_prefix,is_active,expires_at,last_used_at,revoked_at,created_at)")
      .order("created_at", { ascending: false });
    if (error) dbError(error);
    return (data ?? []).map((row) => {
      const profileRaw = row.admin_profiles as unknown;
      const profile = (Array.isArray(profileRaw) ? profileRaw[0] : profileRaw) as { display_name?: string };
      const tokens = (row.automation_service_account_tokens ?? []) as Array<Record<string, unknown>>;
      return {
        id: row.id,
        name: row.name,
        delegatedAdminUserId: row.delegated_admin_user_id,
        delegatedAdminDisplayName: profile?.display_name ?? "Inactive administrator",
        scopes: row.scopes as AutomationScope[],
        isActive: row.is_active,
        expiresAt: row.expires_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        tokens: tokens.map((token) => ({
          id: String(token.id),
          prefix: String(token.token_prefix),
          isActive: Boolean(token.is_active),
          expiresAt: token.expires_at ? String(token.expires_at) : null,
          lastUsedAt: token.last_used_at ? String(token.last_used_at) : null,
          revokedAt: token.revoked_at ? String(token.revoked_at) : null,
          createdAt: String(token.created_at)
        }))
      };
    });
  }

  async createServiceAccount(
    input: {
      name: string;
      delegatedAdminUserId: string;
      scopes: AutomationScope[];
      expiresAt: string | null;
    },
    actorId: string
  ) {
    const generated = generateAutomationToken(automationPepper());
    if (!this.isDurable()) {
      const now = new Date().toISOString();
      const account: AutomationServiceAccount = {
        id: crypto.randomUUID(),
        name: input.name,
        delegatedAdminUserId: input.delegatedAdminUserId,
        delegatedAdminDisplayName: "Demo Admin",
        scopes: [...new Set(input.scopes)],
        isActive: true,
        expiresAt: input.expiresAt,
        createdAt: now,
        updatedAt: now,
        tokens: []
      };
      const token: MemoryToken = {
        id: crypto.randomUUID(),
        prefix: generated.prefix,
        tokenHash: generated.tokenHash,
        isActive: true,
        expiresAt: input.expiresAt,
        lastUsedAt: null,
        revokedAt: null,
        createdAt: now,
        serviceAccountId: account.id
      };
      account.tokens = [tokenPublic(token)];
      memoryState().accounts.unshift(account);
      memoryState().tokens.push(token);
      return { account: structuredClone(account), token: generated.token };
    }
    const { data, error } = await this.client().rpc("create_automation_service_account", {
      p_name: input.name,
      p_delegated_admin_user_id: input.delegatedAdminUserId,
      p_scopes: input.scopes,
      p_expires_at: input.expiresAt,
      p_token_prefix: generated.prefix,
      p_token_hash: generated.tokenHash,
      p_actor_id: actorId
    });
    if (error) dbError(error);
    const account = (await this.listServiceAccounts()).find((item) => item.id === (data as { id: string }).id);
    if (!account) throw new ApiError(500, "DATABASE_ERROR", "The service account could not be read after creation.");
    return { account, token: generated.token };
  }

  async updateServiceAccount(
    id: string,
    input: Partial<{
      name: string;
      delegatedAdminUserId: string;
      scopes: AutomationScope[];
      expiresAt: string | null;
      isActive: boolean;
    }>,
    actorId: string
  ) {
    if (!this.isDurable()) {
      const account = memoryState().accounts.find((item) => item.id === id);
      if (!account) throw new ApiError(404, "NOT_FOUND", "Service account was not found.");
      Object.assign(account, input, { updatedAt: new Date().toISOString() });
      return structuredClone(account);
    }
    const changes: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.name !== undefined) changes.name = input.name;
    if (input.delegatedAdminUserId !== undefined) changes.delegated_admin_user_id = input.delegatedAdminUserId;
    if (input.scopes !== undefined) changes.scopes = input.scopes;
    if (input.expiresAt !== undefined) changes.expires_at = input.expiresAt;
    if (input.isActive !== undefined) changes.is_active = input.isActive;
    const { error } = await this.client().from("automation_service_accounts").update(changes).eq("id", id);
    if (error) dbError(error);
    await this.writeAudit(null, actorId, "admin.automation.service_account.updated", "automation_service_account", id, {
      changedFields: Object.keys(input)
    });
    const account = (await this.listServiceAccounts()).find((item) => item.id === id);
    if (!account) throw new ApiError(404, "NOT_FOUND", "Service account was not found.");
    return account;
  }

  async rotateToken(
    serviceAccountId: string,
    input: { expiresAt: string | null; revokePreviousAfterHours: 0 | 1 | 24 },
    actorId: string
  ) {
    const generated = generateAutomationToken(automationPepper());
    if (!this.isDurable()) {
      const account = memoryState().accounts.find((item) => item.id === serviceAccountId);
      if (!account) throw new ApiError(404, "NOT_FOUND", "Service account was not found.");
      const now = new Date().toISOString();
      if (input.revokePreviousAfterHours === 0) {
        for (const token of memoryState().tokens.filter((item) => item.serviceAccountId === serviceAccountId)) {
          token.isActive = false;
          token.revokedAt = now;
        }
      }
      const token: MemoryToken = {
        id: crypto.randomUUID(),
        prefix: generated.prefix,
        tokenHash: generated.tokenHash,
        isActive: true,
        expiresAt: input.expiresAt,
        lastUsedAt: null,
        revokedAt: null,
        createdAt: now,
        serviceAccountId
      };
      memoryState().tokens.push(token);
      account.tokens = memoryState().tokens.filter((item) => item.serviceAccountId === serviceAccountId).map(tokenPublic);
      account.updatedAt = now;
      return { account: structuredClone(account), token: generated.token };
    }
    const { error } = await this.client().rpc("rotate_automation_service_account_token", {
      p_service_account_id: serviceAccountId,
      p_token_prefix: generated.prefix,
      p_token_hash: generated.tokenHash,
      p_expires_at: input.expiresAt,
      p_revoke_previous_after_hours: input.revokePreviousAfterHours,
      p_actor_id: actorId
    });
    if (error) dbError(error);
    const account = (await this.listServiceAccounts()).find((item) => item.id === serviceAccountId);
    if (!account) throw new ApiError(404, "NOT_FOUND", "Service account was not found.");
    return { account, token: generated.token };
  }

  async revokeToken(serviceAccountId: string, tokenId: string, actorId: string) {
    const now = new Date().toISOString();
    if (!this.isDurable()) {
      const token = memoryState().tokens.find(
        (item) => item.id === tokenId && item.serviceAccountId === serviceAccountId
      );
      if (!token) throw new ApiError(404, "NOT_FOUND", "Token was not found.");
      token.isActive = false;
      token.revokedAt = now;
      const account = memoryState().accounts.find((item) => item.id === serviceAccountId);
      if (account) account.tokens = memoryState().tokens.filter((item) => item.serviceAccountId === serviceAccountId).map(tokenPublic);
      return;
    }
    const { data, error } = await this.client()
      .from("automation_service_account_tokens")
      .update({ is_active: false, revoked_at: now, revoked_by: actorId })
      .eq("id", tokenId)
      .eq("service_account_id", serviceAccountId)
      .select("id")
      .maybeSingle();
    if (error) dbError(error);
    if (!data) throw new ApiError(404, "NOT_FOUND", "Token was not found.");
    await this.writeAudit(null, actorId, "admin.automation.token.revoked", "automation_service_account", serviceAccountId, {
      tokenId
    });
  }

  async claim(input: {
    serviceAccountId: string;
    key: string;
    requestHash: string;
    method: string;
    path: string;
  }) {
    if (!this.isDurable()) {
      const mapKey = `${input.serviceAccountId}:${input.key}`;
      const existing = memoryState().idempotency.get(mapKey);
      if (existing) return { state: "existing" as const, record: structuredClone(existing) };
      const record: IdempotencyRecord = {
        serviceAccountId: input.serviceAccountId,
        key: input.key,
        requestHash: input.requestHash,
        status: "in_progress",
        responseStatus: null,
        responseRedacted: null,
        failureCode: null
      };
      memoryState().idempotency.set(mapKey, record);
      return { state: "claimed" as const, record: structuredClone(record) };
    }
    const { data, error } = await this.client().rpc("claim_automation_idempotency_key", {
      p_service_account_id: input.serviceAccountId,
      p_idempotency_key: input.key,
      p_request_hash: input.requestHash,
      p_method: input.method,
      p_normalized_path: input.path
    });
    if (error) dbError(error);
    const result = data as Record<string, unknown>;
    return {
      state: result.claimed ? "claimed" as const : "existing" as const,
      record: {
        serviceAccountId: input.serviceAccountId,
        key: input.key,
        requestHash: String(result.request_hash),
        status: result.status as IdempotencyRecord["status"],
        responseStatus: result.response_status === null ? null : Number(result.response_status),
        responseRedacted: result.response_redacted,
        failureCode: result.failure_code ? String(result.failure_code) : null
      }
    };
  }

  async complete(input: {
    serviceAccountId: string;
    key: string;
    responseStatus: number;
    responseRedacted: unknown;
    resourceType?: string;
    resourceId?: string;
    resourceVersion?: string | null;
  }) {
    const safeResponse = redactValue(input.responseRedacted);
    if (!this.isDurable()) {
      const record = memoryState().idempotency.get(`${input.serviceAccountId}:${input.key}`);
      if (!record) throw new ApiError(500, "IDEMPOTENCY_STATE_MISSING", "The idempotency state is unavailable.");
      Object.assign(record, {
        status: "completed",
        responseStatus: input.responseStatus,
        responseRedacted: safeResponse
      });
      return;
    }
    const { error } = await this.client().rpc("complete_automation_idempotency_key", {
      p_service_account_id: input.serviceAccountId,
      p_idempotency_key: input.key,
      p_response_status: input.responseStatus,
      p_response_redacted: safeResponse,
      p_resource_type: input.resourceType ?? null,
      p_resource_id: input.resourceId ?? null,
      p_resource_version: input.resourceVersion ?? null
    });
    if (error) dbError(error);
  }

  async fail(input: { serviceAccountId: string; key: string; failureCode: string }) {
    if (!this.isDurable()) {
      const record = memoryState().idempotency.get(`${input.serviceAccountId}:${input.key}`);
      if (record) Object.assign(record, { status: "failed", failureCode: input.failureCode });
      return;
    }
    const { error } = await this.client().rpc("fail_automation_idempotency_key", {
      p_service_account_id: input.serviceAccountId,
      p_idempotency_key: input.key,
      p_failure_code: input.failureCode
    });
    if (error) dbError(error);
  }

  async health(): Promise<AutomationHealth> {
    const environment = readServerEnvironment();
    const pause = await getRepository().getPause();
    return {
      apiVersion: "v1",
      serverTime: new Date().toISOString(),
      dataBackend: environment.DATA_BACKEND,
      durableBackendReady: environment.DATA_BACKEND === "supabase",
      emailProviderMode: environment.emailProviderMode,
      smsProviderMode: environment.smsProviderMode,
      remindersForcePaused: environment.remindersForcePaused,
      remindersGlobalPaused: pause.paused,
      effectiveReminderPause: environment.remindersForcePaused || pause.paused,
      featureFlags: {
        api: environment.AUTOMATION_API_ENABLED === "true",
        mutations: environment.AUTOMATION_MUTATIONS_ENABLED === "true",
        confirmations: environment.AUTOMATION_CONFIRMATIONS_ENABLED === "true",
        tenantImport: environment.AUTOMATION_TENANT_IMPORT_ENABLED === "true"
      }
    };
  }

  async listRentals(input: { status?: string; q?: string; limit: number; cursor?: string }) {
    const source = await getRepository().listRentals(true);
    let rentals: AutomationRental[] = source.map((rental) => ({
      ...rental,
      ...(memoryState().externalRentals.get(rental.id) ?? { sourceSystem: null, externalReference: null })
    }));
    if (this.isDurable() && rentals.length > 0) {
      const { data, error } = await this.client()
        .from("rental_listings")
        .select("id,source_system,external_reference")
        .in("id", rentals.map((rental) => rental.id));
      if (error) dbError(error);
      const refs = new Map((data ?? []).map((row) => [
        row.id,
        { sourceSystem: row.source_system, externalReference: row.external_reference }
      ]));
      rentals = rentals.map((rental) => ({ ...rental, ...(refs.get(rental.id) ?? {}) }));
    }
    if (input.status) rentals = rentals.filter((rental) => rental.status === input.status);
    if (input.q) {
      const query = input.q.toLowerCase();
      rentals = rentals.filter((rental) =>
        [rental.title, rental.addressLine, rental.city, rental.slug].some((value) => value.toLowerCase().includes(query))
      );
    }
    rentals.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id));
    return cursorPage(rentals, input.limit, input.cursor);
  }

  async getRental(id: string) {
    const rental = await getRepository().getRental(id);
    let external = memoryState().externalRentals.get(id) ?? { sourceSystem: null, externalReference: null };
    if (this.isDurable()) {
      const { data, error } = await this.client()
        .from("rental_listings")
        .select("source_system,external_reference")
        .eq("id", id)
        .single();
      if (error) dbError(error);
      external = { sourceSystem: data.source_system, externalReference: data.external_reference };
    }
    return { ...rental, ...external } as AutomationRental;
  }

  async saveRentalDraft(
    id: string | null,
    payload: unknown,
    expectedVersion: string | null,
    actor: AutomationActor
  ) {
    const input = automationRentalInputSchema.parse(payload);
    if (id) {
      const current = await this.getRental(id);
      if (current.status === "published") {
        throw new ApiError(409, "RENTAL_MUST_BE_UNPUBLISHED", "Published rentals must be confirmed as unpublished before editing.");
      }
      if (current.status === "archived") {
        throw new ApiError(409, "RENTAL_ARCHIVED", "Archived rentals cannot be edited.");
      }
    }
    const rentalPayload = { ...input, coverImageUrl: null };
    delete (rentalPayload as Partial<typeof rentalPayload>).sourceSystem;
    delete (rentalPayload as Partial<typeof rentalPayload>).externalReference;
    const saved = id
      ? await getRepository().updateRental(id, rentalPayload, expectedVersion, actor.delegatedAdminUserId)
      : await getRepository().createRental(rentalPayload, actor.delegatedAdminUserId);
    if (this.isDurable()) {
      const { error } = await this.client()
        .from("rental_listings")
        .update({ source_system: input.sourceSystem, external_reference: input.externalReference })
        .eq("id", saved.id);
      if (error) dbError(error);
    } else {
      memoryState().externalRentals.set(saved.id, {
        sourceSystem: input.sourceSystem,
        externalReference: input.externalReference
      });
    }
    await this.writeAudit(actor, actor.delegatedAdminUserId, id ? "automation.rental.updated" : "automation.rental.created", "rental_listing", saved.id, {
      changedFields: Object.keys(input).filter((key) => !["description", "addressLine"].includes(key))
    });
    return this.getRental(saved.id);
  }

  async uploadMedia(file: File, altText: string, actor: AutomationActor) {
    const asset = await uploadMediaAsset(file, altText, actor.delegatedAdminUserId);
    await this.writeAudit(actor, actor.delegatedAdminUserId, "automation.media.uploaded", "media_asset", asset.id, {
      mimeType: asset.mimeType,
      byteSize: asset.byteSize
    });
    return asset;
  }

  async listTenants(input: { q?: string; property?: string; limit: number; cursor?: string }) {
    let tenants = await this.allAutomationTenants();
    if (input.q) {
      const query = input.q.toLowerCase();
      tenants = tenants.filter((tenant) =>
        tenant.fullName.toLowerCase().includes(query) ||
        tenant.externalReference?.toLowerCase().includes(query)
      );
    }
    if (input.property) {
      const property = input.property.toLowerCase();
      tenants = tenants.filter((tenant) => tenant.propertyLabel.toLowerCase().includes(property));
    }
    tenants.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id));
    const page = cursorPage(tenants, input.limit, input.cursor);
    return {
      ...page,
      items: page.items.map((tenant) => ({
        id: tenant.id,
        fullName: tenant.fullName,
        propertyLabel: tenant.propertyLabel,
        unitLabel: tenant.unitLabel,
        emailMasked: maskEmail(tenant.email),
        phoneMasked: maskPhone(tenant.phoneE164),
        preferredChannels: tenant.preferredChannels,
        emailContactStatus: tenant.emailContactStatus,
        smsContactStatus: tenant.smsContactStatus,
        isActive: tenant.isActive,
        sourceSystem: tenant.sourceSystem,
        externalReference: tenant.externalReference,
        updatedAt: tenant.updatedAt
      }))
    };
  }

  async getTenant(id: string) {
    const result = await getRepository().getTenant(id);
    const tenant = await this.withAutomationIdentity(result.tenant);
    return {
      tenant: {
        ...tenant,
        email: maskEmail(tenant.email),
        phoneE164: maskPhone(tenant.phoneE164),
        internalNotes: null
      },
      schedule: result.schedule
    };
  }

  private async withAutomationIdentity(tenant: Tenant): Promise<AutomationTenant> {
    if (!this.isDurable()) {
      return {
        ...tenant,
        ...(memoryState().externalTenants.get(tenant.id) ?? {
          sourceSystem: null,
          externalReference: null
        })
      };
    }
    const { data, error } = await this.client()
      .from("tenants")
      .select("source_system,external_reference")
      .eq("id", tenant.id)
      .maybeSingle();
    if (error) dbError(error);
    return {
      ...tenant,
      sourceSystem: data?.source_system ?? null,
      externalReference: data?.external_reference ?? null
    };
  }

  private async allAutomationTenants(): Promise<AutomationTenant[]> {
    let tenants: AutomationTenant[] = (await getRepository().listTenants()).map((tenant) => ({
      ...tenant,
      ...(memoryState().externalTenants.get(tenant.id) ?? { sourceSystem: null, externalReference: null })
    }));
    if (this.isDurable() && tenants.length > 0) {
      const { data, error } = await this.client()
        .from("tenants")
        .select("id,source_system,external_reference")
        .in("id", tenants.map((tenant) => tenant.id));
      if (error) dbError(error);
      const refs = new Map((data ?? []).map((row) => [
        row.id,
        { sourceSystem: row.source_system, externalReference: row.external_reference }
      ]));
      tenants = tenants.map((tenant) => ({ ...tenant, ...(refs.get(tenant.id) ?? {}) }));
    }
    return tenants;
  }

  async saveTenant(
    id: string | null,
    payload: unknown,
    expectedVersion: string | null,
    actor: AutomationActor,
    options: { allowNewEmailPermission?: boolean } = {}
  ) {
    const input = automationTenantInputSchema.parse(payload);
    const current = id ? (await getRepository().getTenant(id)).tenant : null;
    if (
      current &&
      ((current.emailContactStatus !== "allowed" && input.emailContactStatus === "allowed") ||
        (current.smsContactStatus !== "allowed" && input.smsContactStatus === "allowed"))
    ) {
      throw new ApiError(403, "CONFIRMATION_REQUIRED", "Permission grants require an evidence-bound confirmation.");
    }
    if (
      !current &&
      (input.emailContactStatus === "allowed" || input.smsContactStatus === "allowed") &&
      !options.allowNewEmailPermission
    ) {
      throw new ApiError(403, "CONFIRMATION_REQUIRED", "Automation-created tenants default to unconfirmed contact permission.");
    }
    const safeInput = {
      ...input,
      emailContactStatus:
        current?.emailContactStatus === "allowed" &&
        current.email === input.email
          ? "allowed"
          : input.emailContactStatus,
      smsContactStatus:
        current?.smsContactStatus === "allowed" &&
        current.phoneE164 === input.phoneE164
          ? "allowed"
          : input.smsContactStatus
    };
    let savedId: string;
    if (this.isDurable()) {
      const { data, error } = await this.client().rpc("save_tenant", {
        p_id: id,
        p_payload: safeInput,
        p_expected_updated_at: expectedVersion,
        p_actor_id: actor.delegatedAdminUserId
      });
      if (error) dbError(error);
      const durableId = (data as { id?: unknown } | null)?.id;
      if (typeof durableId !== "string") {
        dbError({ message: "The tenant save did not return a resource identifier." });
      }
      savedId = durableId;
    } else {
      const repositoryInput = { ...safeInput };
      delete (repositoryInput as Partial<typeof repositoryInput>).sourceSystem;
      delete (repositoryInput as Partial<typeof repositoryInput>).externalReference;
      const saved = id
        ? await getRepository().updateTenant(id, repositoryInput, expectedVersion, actor.delegatedAdminUserId)
        : await getRepository().createTenant(repositoryInput, actor.delegatedAdminUserId);
      savedId = saved.id;
      memoryState().externalTenants.set(savedId, {
        sourceSystem: input.sourceSystem,
        externalReference: input.externalReference
      });
    }
    await this.writeAudit(actor, actor.delegatedAdminUserId, id ? "automation.tenant.updated" : "automation.tenant.created", "tenant", savedId, {
      changedFields: Object.keys(input).filter((key) => !["email", "phoneE164", "internalNotes"].includes(key))
    });
    const savedTenant = (await this.allAutomationTenants()).find((tenant) => tenant.id === savedId);
    if (!savedTenant) dbError({ message: "The saved tenant could not be reloaded." });
    return savedTenant;
  }

  async onboardTenantFromPdf(
    payload: unknown,
    confirmation: { confirmedAt: string; documentDigest: string },
    actor: AutomationActor
  ) {
    const input = automationTenantInputSchema.parse(payload);
    if (!input.email) {
      throw new ApiError(
        422,
        "EMAIL_REQUIRED",
        "PDF tenant onboarding requires an email address."
      );
    }
    const tenant = await this.saveTenant(
      null,
      {
        ...input,
        preferredChannels: Array.from(new Set([...input.preferredChannels, "email"])),
        emailContactStatus: "allowed",
        emailContactStatusReason: "Owner confirmed the extracted tenant details.",
        emailContactStatusSource: "owner_confirmed_pdf_onboarding",
        smsContactStatus: "unconfirmed",
        smsContactStatusReason: null,
        smsContactStatusSource: null,
        contactPermissionNote: `PDF onboarding confirmation ${confirmation.documentDigest}`,
        contactPermissionUpdatedAt: confirmation.confirmedAt
      },
      null,
      actor,
      { allowNewEmailPermission: true }
    );
    await this.writeAudit(
      actor,
      actor.delegatedAdminUserId,
      "automation.tenant.onboarded_from_pdf",
      "tenant",
      tenant.id,
      {
        emailPermissionGranted: true,
        reminderPolicyApplied: true,
        confirmationRecordedAt: confirmation.confirmedAt,
        documentDigest: confirmation.documentDigest
      }
    );
    return tenant;
  }

  async patchTenant(
    id: string,
    changes: Record<string, unknown>,
    expectedVersion: string,
    actor: AutomationActor
  ) {
    const stored = await getRepository().getTenant(id);
    const current = await this.withAutomationIdentity(stored.tenant);
    if (current.updatedAt !== expectedVersion) {
      throw new ApiError(
        409,
        "VERSION_CONFLICT",
        "The tenant changed after it was loaded."
      );
    }

    const hasEmailChange = Object.hasOwn(changes, "email");
    const hasPhoneChange = Object.hasOwn(changes, "phoneE164");
    const nextEmail = hasEmailChange
      ? (changes.email as string | null)
      : current.email;
    const nextPhone = hasPhoneChange
      ? (changes.phoneE164 as string | null)
      : current.phoneE164;
    const emailChanged = hasEmailChange && nextEmail !== current.email;
    const phoneChanged = hasPhoneChange && nextPhone !== current.phoneE164;

    let preferredChannels = Object.hasOwn(changes, "preferredChannels")
      ? [...(changes.preferredChannels as Tenant["preferredChannels"])]
      : [...current.preferredChannels];
    if (!Object.hasOwn(changes, "preferredChannels")) {
      const channels = new Set(preferredChannels);
      if (hasEmailChange) {
        if (nextEmail) channels.add("email");
        else channels.delete("email");
      }
      if (hasPhoneChange) {
        if (nextPhone) channels.add("sms");
        else channels.delete("sms");
      }
      preferredChannels = [...channels];
    }

    const payload: Record<string, unknown> = {
      ...current,
      ...changes,
      preferredChannels,
      sourceSystem: current.sourceSystem,
      externalReference: current.externalReference
    };
    delete payload.id;
    delete payload.createdAt;
    delete payload.updatedAt;
    delete payload.archivedAt;
    delete payload.scheduleStatus;
    delete payload.nextRunAt;
    delete payload.lastDeliveryStatus;
    delete payload.lastDeliveryAt;

    if (emailChanged) {
      payload.emailContactStatus = "unconfirmed";
      payload.emailContactStatusReason = null;
      payload.emailContactStatusSource = null;
    }
    if (phoneChanged) {
      payload.smsContactStatus = "unconfirmed";
      payload.smsContactStatusReason = null;
      payload.smsContactStatusSource = null;
    }
    if (emailChanged || phoneChanged) {
      payload.contactPermissionNote = null;
      payload.contactPermissionUpdatedAt = new Date().toISOString();
    }

    return this.saveTenant(id, payload, expectedVersion, actor);
  }

  async saveDisabledSchedule(
    tenantId: string,
    schedule: unknown,
    expectedVersion: string | null,
    actor: AutomationActor
  ) {
    const saved = await getRepository().saveSchedule(
      tenantId,
      schedule,
      expectedVersion,
      actor.delegatedAdminUserId
    );
    const candidateNextRunAt = nextOccurrence({
      dayOfMonth: saved.dayOfMonth,
      localTime: saved.localTime,
      timezone: saved.timezone,
      afterInstant: new Date().toISOString()
    });
    await this.writeAudit(actor, actor.delegatedAdminUserId, "automation.schedule.saved_disabled", "reminder_schedule", saved.id, {
      tenantId,
      channels: saved.channels,
      timezone: saved.timezone
    });
    return { ...saved, candidateNextRunAt };
  }

  async createConfirmation(input: {
    actor: AutomationActor;
    action: AutomationConfirmationAction;
    targetType: string;
    targetId: string;
    targetVersion: string | null;
    payload: Record<string, unknown>;
    summary: AutomationConfirmationIntent["summary"];
    requiredAcknowledgements: string[];
  }) {
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
    const digest = createConfirmationDigest({
      serviceAccountId: input.actor.serviceAccountId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      targetVersion: input.targetVersion,
      payload: input.payload,
      expiresAt
    });
    const intent: AutomationConfirmationIntent = {
      id: crypto.randomUUID(),
      serviceAccountId: input.actor.serviceAccountId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      targetVersion: input.targetVersion,
      digest,
      payload: input.payload,
      summary: input.summary,
      requiredAcknowledgements: input.requiredAcknowledgements,
      expiresAt,
      consumedAt: null,
      createdAt
    };
    if (!this.isDurable()) memoryState().confirmations.push(intent);
    else {
      const { error } = await this.client().from("automation_confirmation_intents").insert({
        id: intent.id,
        service_account_id: intent.serviceAccountId,
        action: intent.action,
        target_type: intent.targetType,
        target_id: intent.targetId,
        target_version: intent.targetVersion,
        request_digest: intent.digest,
        payload: intent.payload,
        summary: intent.summary,
        required_acknowledgements: intent.requiredAcknowledgements,
        expires_at: intent.expiresAt
      });
      if (error) dbError(error);
    }
    return intent;
  }

  async getConfirmation(id: string): Promise<AutomationConfirmationIntent> {
    if (!this.isDurable()) {
      const intent = memoryState().confirmations.find((item) => item.id === id);
      if (!intent) throw new ApiError(404, "NOT_FOUND", "Confirmation was not found.");
      return structuredClone(intent);
    }
    const { data, error } = await this.client()
      .from("automation_confirmation_intents")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) dbError(error);
    if (!data) throw new ApiError(404, "NOT_FOUND", "Confirmation was not found.");
    return {
      id: data.id,
      serviceAccountId: data.service_account_id,
      action: data.action,
      targetType: data.target_type,
      targetId: data.target_id,
      targetVersion: data.target_version,
      digest: data.request_digest,
      payload: data.payload,
      summary: data.summary,
      requiredAcknowledgements: data.required_acknowledgements,
      expiresAt: data.expires_at,
      consumedAt: data.consumed_at,
      createdAt: data.created_at
    };
  }

  async executeConfirmation(intent: AutomationConfirmationIntent, idempotencyKey: string, actor: AutomationActor) {
    if (intent.action === "schedule.enable" || intent.action === "schedule.disable") {
      throw new ApiError(
        409,
        "GLOBAL_REMINDER_POLICY",
        "Per-tenant reminder schedules are read-only under the global reminder policy."
      );
    }
    if (
      this.isDurable() &&
      (intent.action === "tenant_import.commit" || intent.action === "tenant.permission.grant")
    ) {
      const { data, error } = await this.client().rpc("execute_automation_confirmation", {
        p_confirmation_id: intent.id,
        p_service_account_id: actor.serviceAccountId,
        p_idempotency_key: idempotencyKey,
        p_now: new Date().toISOString()
      });
      if (error) {
        if (error.code === "TT409") throw new ApiError(409, "PREVIEW_STALE", "The preview is stale.");
        dbError(error);
      }
      return data;
    }
    if (
      this.isDurable() &&
      intent.action.startsWith("rental.")
    ) {
      return getRepository().executeAutomationResourceConfirmation({
        confirmationId: intent.id,
        serviceAccountId: actor.serviceAccountId,
        idempotencyKey,
        targetId: intent.targetId,
        action: intent.action as
          | "rental.publish"
          | "rental.unpublish"
          | "rental.archive"
      });
    }
    let result: unknown;
    if (intent.action.startsWith("rental.")) {
      const action = intent.action.split(".")[1] as "publish" | "unpublish" | "archive";
      const current = await getRepository().getRental(intent.targetId);
      if (current.updatedAt !== intent.targetVersion) throw new ApiError(409, "PREVIEW_STALE", "The rental changed after preview.");
      result = await getRepository().setRentalStatus(
        intent.targetId,
        action,
        intent.targetVersion,
        actor.delegatedAdminUserId
      );
    } else if (intent.action === "tenant.permission.grant") {
      const current = await getRepository().getTenant(intent.targetId);
      if (current.tenant.updatedAt !== intent.targetVersion) {
        throw new ApiError(409, "PREVIEW_STALE", "The tenant changed after preview.");
      }
      const channel = String(intent.payload.channel);
      const tenantPayload = { ...current.tenant } as Record<string, unknown>;
      delete tenantPayload.id;
      delete tenantPayload.createdAt;
      delete tenantPayload.updatedAt;
      delete tenantPayload.archivedAt;
      tenantPayload[channel === "email" ? "emailContactStatus" : "smsContactStatus"] = "allowed";
      tenantPayload[channel === "email" ? "emailContactStatusSource" : "smsContactStatusSource"] = intent.payload.source;
      tenantPayload[channel === "email" ? "emailContactStatusReason" : "smsContactStatusReason"] = intent.payload.reason;
      tenantPayload.contactPermissionUpdatedAt = intent.payload.permissionRecordedAt;
      result = await getRepository().updateTenant(
        intent.targetId,
        tenantPayload,
        intent.targetVersion,
        actor.delegatedAdminUserId
      );
    } else if (intent.action === "tenant_import.commit") {
      result = await this.commitMemoryImport(intent.targetId, actor);
    } else {
      throw new ApiError(422, "CONFIRMATION_ACTION_UNSUPPORTED", "The confirmation action is not supported.");
    }
    if (this.isDurable()) {
      const { error } = await this.client().rpc("consume_automation_confirmation", {
        p_confirmation_id: intent.id,
        p_service_account_id: actor.serviceAccountId,
        p_idempotency_key: idempotencyKey
      });
      if (error) dbError(error);
    } else {
      const stored = memoryState().confirmations.find((item) => item.id === intent.id);
      if (stored) stored.consumedAt = new Date().toISOString();
    }
    await this.writeAudit(actor, actor.delegatedAdminUserId, `automation.${intent.action.replace(".", ".")}`, intent.targetType, intent.targetId, {
      confirmationId: intent.id
    });
    return result;
  }

  async createTenantImport(
    file: File,
    mode: "create_only" | "create_or_update",
    sourceSystem: string,
    actor: AutomationActor
  ) {
    const parsed = await parseTenantImportFile(file);
    const templates = await getRepository().listTemplates();
    const existingTenants = await this.allAutomationTenants();
    const normalized = parsed.rows.map((row) => normalizeTenantImportRow(row, templates));
    const duplicateOutcomes = detectWithinFileDuplicates(normalized.map((item) => item.value));
    const rows: TenantImportRow[] = normalized.map((item, index) => {
      const duplicate = duplicateOutcomes.get(index);
      const permissionGrantWithoutScope = Boolean(
        item.value &&
        !actor.scopes.includes("permissions:grant") &&
        (
          item.value.emailContactStatus === "allowed" ||
          item.value.smsContactStatus === "allowed"
        )
      );
      const match = item.value
        ? matchTenantImportRow(item.value, existingTenants, sourceSystem, mode)
        : null;
      const outcome: TenantImportOutcome = !item.value || permissionGrantWithoutScope
        ? "invalid"
        : duplicate ?? match!.outcome;
      return {
        id: crypto.randomUUID(),
        rowNumber: index + 2,
        rowDigest: sha256Digest(item.value ?? parsed.rows[index]),
        outcome,
        matchedTenantId: match?.matchedTenant?.id ?? null,
        expectedTenantVersion: match?.matchedTenant?.updatedAt ?? null,
        normalizedPayload: item.value,
        changedFields: match?.changedFields ?? [],
        errorCodes: [
          ...item.errorCodes,
          ...(permissionGrantWithoutScope ? ["PERMISSIONS_GRANT_SCOPE_REQUIRED"] : []),
          ...(duplicate === "conflict" ? ["WITHIN_FILE_CONFLICT"] : []),
          ...(duplicate === "duplicate" ? ["WITHIN_FILE_DUPLICATE"] : []),
          ...(match?.errorCodes ?? [])
        ],
        warnings: [...parsed.headerWarnings, ...item.warnings],
        display: item.value
          ? `${item.value.fullName.slice(0, 1)}*** · ${item.value.propertyLabel} · ${item.value.unitLabel ?? "No unit"}`
          : `Row ${index + 2}`,
        emailMasked: maskEmail(item.value?.email ?? null),
        phoneMasked: maskPhone(item.value?.phoneE164 ?? null)
      };
    });
    const counts = Object.fromEntries(
      ["new", "update", "unchanged", "duplicate", "conflict", "invalid"].map((outcome) => [
        outcome,
        rows.filter((row) => row.outcome === outcome).length
      ])
    ) as Record<TenantImportOutcome, number>;
    const now = new Date().toISOString();
    const sourceDigest = sha256Digest(new Uint8Array(await file.arrayBuffer()));
    const batch: TenantImportBatch = {
      id: crypto.randomUUID(),
      jobId: crypto.randomUUID(),
      serviceAccountId: actor.serviceAccountId,
      sourceSystem,
      importMode: mode,
      originalFilename: file.name.replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 180),
      sourceDigest,
      rowCount: rows.length,
      counts,
      previewVersion: now,
      committedAt: null,
      createdAt: now,
      status: "preview_ready",
      rows
    };
    if (!this.isDurable()) memoryState().imports.push(batch);
    else {
      const bucket = process.env.AUTOMATION_IMPORT_BUCKET ?? "automation-imports";
      const path = `${actor.serviceAccountId}/${batch.id}/${batch.originalFilename}`;
      const { error: uploadError } = await this.client().storage.from(bucket).upload(
        path,
        await file.arrayBuffer(),
        { contentType: file.type || "application/octet-stream", upsert: false }
      );
      if (uploadError) throw new ApiError(502, "IMPORT_STORAGE_FAILED", "The import source could not be stored privately.");
      const { error } = await this.client().rpc("persist_tenant_import_preview", {
        p_import: {
          ...batch,
          rows: undefined,
          privateStoragePath: path
        },
        p_rows: rows.map((row) => ({
          ...row,
          normalizedPayload: row.normalizedPayload
        }))
      });
      if (error) dbError(error);
    }
    await this.writeAudit(actor, actor.delegatedAdminUserId, "automation.tenant_import.preview_completed", "tenant_import", batch.id, {
      counts,
      rowCount: batch.rowCount,
      jobId: batch.jobId
    });
    return this.safeImport(batch);
  }

  async getTenantImport(id: string, actor: AutomationActor) {
    const batch = await this.loadImport(id);
    if (batch.serviceAccountId !== actor.serviceAccountId) {
      throw new ApiError(404, "NOT_FOUND", "Tenant import was not found.");
    }
    return this.safeImport(batch);
  }

  async tenantImportPermissionGrantCount(id: string, actor: AutomationActor) {
    const batch = await this.loadImport(id);
    if (batch.serviceAccountId !== actor.serviceAccountId) {
      throw new ApiError(404, "NOT_FOUND", "Tenant import was not found.");
    }
    return batch.rows
      .filter((row) => row.outcome === "new" || row.outcome === "update")
      .reduce((count, row) => count +
        Number(
          row.normalizedPayload?.emailContactStatus === "allowed" &&
          (row.outcome === "new" || row.changedFields.includes("emailContactStatus"))
        ) +
        Number(
          row.normalizedPayload?.smsContactStatus === "allowed" &&
          (row.outcome === "new" || row.changedFields.includes("smsContactStatus"))
        ), 0);
  }

  async listTenantImportRows(
    id: string,
    actor: AutomationActor,
    input: { outcome?: TenantImportOutcome; limit: number; cursor?: string }
  ) {
    const batch = await this.loadImport(id);
    if (batch.serviceAccountId !== actor.serviceAccountId) throw new ApiError(404, "NOT_FOUND", "Tenant import was not found.");
    let rows = batch.rows;
    if (input.outcome) rows = rows.filter((row) => row.outcome === input.outcome);
    const page = cursorPage(rows.map((row) => ({ ...row, createdAt: batch.createdAt })), input.limit, input.cursor);
    return {
      items: page.items.map((row) => {
        const safe = { ...row } as Partial<typeof row>;
        delete safe.normalizedPayload;
        delete safe.createdAt;
        return safe;
      }),
      nextCursor: page.nextCursor
    };
  }

  async getJob(jobId: string, actor: AutomationActor) {
    if (!this.isDurable()) {
      const batch = memoryState().imports.find(
        (item) => item.jobId === jobId && item.serviceAccountId === actor.serviceAccountId
      );
      if (!batch) throw new ApiError(404, "NOT_FOUND", "Automation job was not found.");
      return {
        id: batch.jobId,
        jobType: "tenant_import",
        status: batch.status,
        progressCurrent: batch.rowCount,
        progressTotal: batch.rowCount,
        safeErrorCode: null,
        importId: batch.id,
        counts: batch.counts,
        createdAt: batch.createdAt,
        completedAt: batch.committedAt
      };
    }
    const { data, error } = await this.client()
      .from("automation_jobs")
      .select("id,service_account_id,job_type,status,progress_current,progress_total,safe_error_code,safe_error_details,started_at,completed_at,created_at,tenant_imports(id,new_count,update_count,unchanged_count,duplicate_count,conflict_count,invalid_count)")
      .eq("id", jobId)
      .eq("service_account_id", actor.serviceAccountId)
      .maybeSingle();
    if (error) dbError(error);
    if (!data) throw new ApiError(404, "NOT_FOUND", "Automation job was not found.");
    return data;
  }

  private async loadImport(id: string): Promise<TenantImportBatch> {
    if (!this.isDurable()) {
      const batch = memoryState().imports.find((item) => item.id === id);
      if (!batch) throw new ApiError(404, "NOT_FOUND", "Tenant import was not found.");
      return batch;
    }
    const { data, error } = await this.client().rpc("get_tenant_import_for_automation", { p_import_id: id });
    if (error) dbError(error);
    if (!data) throw new ApiError(404, "NOT_FOUND", "Tenant import was not found.");
    return data as TenantImportBatch;
  }

  private safeImport(batch: TenantImportBatch): Omit<TenantImportBatch, "rows"> {
    const safe = { ...batch } as Partial<TenantImportBatch>;
    delete safe.rows;
    return safe as Omit<TenantImportBatch, "rows">;
  }

  private async commitMemoryImport(importId: string, actor: AutomationActor) {
    const batch = await this.loadImport(importId);
    if (batch.status === "completed") return this.safeImport(batch);
    if (batch.counts.invalid > 0 || batch.counts.conflict > 0) {
      throw new ApiError(409, "IMPORT_HAS_ERRORS", "The import contains blocking rows.");
    }
    const currentTenants = await this.allAutomationTenants();
    for (const row of batch.rows.filter((item) => item.outcome === "update")) {
      const tenant = currentTenants.find((item) => item.id === row.matchedTenantId);
      if (!tenant || tenant.updatedAt !== row.expectedTenantVersion) {
        throw new ApiError(409, "PREVIEW_STALE", "A tenant changed after the import preview.");
      }
    }
    for (const row of batch.rows.filter((item) => item.outcome === "new" || item.outcome === "update")) {
      const payload = row.normalizedPayload!;
      const existing = row.matchedTenantId
        ? (await getRepository().getTenant(row.matchedTenantId)).tenant
        : null;
      const tenantInput = {
        sourceSystem: batch.sourceSystem,
        externalReference: payload.externalReference,
        fullName: payload.fullName,
        propertyLabel: payload.propertyLabel,
        unitLabel: payload.unitLabel,
        email: payload.email,
        phoneE164: payload.phoneE164,
        preferredChannels: payload.preferredChannels,
        emailContactStatus: payload.emailContactStatus,
        smsContactStatus: payload.smsContactStatus,
        emailContactStatusReason: payload.emailPermissionSource,
        smsContactStatusReason: payload.smsPermissionSource,
        emailContactStatusSource: payload.emailPermissionSource,
        smsContactStatusSource: payload.smsPermissionSource,
        contactPermissionNote: null,
        contactPermissionUpdatedAt: payload.emailPermissionRecordedAt ?? payload.smsPermissionRecordedAt,
        timezone: payload.timezone,
        internalNotes: payload.internalNotes,
        isActive: payload.isActive
      };
      const saved = row.outcome === "new"
        ? await this.saveTenant(null, {
            ...tenantInput,
            emailContactStatus: tenantInput.emailContactStatus === "allowed" ? "unconfirmed" : tenantInput.emailContactStatus,
            smsContactStatus: tenantInput.smsContactStatus === "allowed" ? "unconfirmed" : tenantInput.smsContactStatus
          }, null, actor)
        : await this.saveTenant(row.matchedTenantId, {
            ...tenantInput,
            emailContactStatus:
              tenantInput.emailContactStatus === "allowed" && existing?.emailContactStatus !== "allowed"
                ? existing?.emailContactStatus ?? "unconfirmed"
                : tenantInput.emailContactStatus,
            smsContactStatus:
              tenantInput.smsContactStatus === "allowed" && existing?.smsContactStatus !== "allowed"
                ? existing?.smsContactStatus ?? "unconfirmed"
                : tenantInput.smsContactStatus
          }, row.expectedTenantVersion, actor);
      for (const channel of ["email", "sms"] as const) {
        const requestedStatus = channel === "email"
          ? payload.emailContactStatus
          : payload.smsContactStatus;
        const previousStatus = channel === "email"
          ? existing?.emailContactStatus
          : existing?.smsContactStatus;
        if (requestedStatus !== "allowed" || previousStatus === "allowed") continue;
        const current = await getRepository().getTenant(saved.id);
        const permissionPayload = { ...current.tenant } as Record<string, unknown>;
        delete permissionPayload.id;
        delete permissionPayload.createdAt;
        delete permissionPayload.updatedAt;
        delete permissionPayload.archivedAt;
        permissionPayload[
          channel === "email" ? "emailContactStatus" : "smsContactStatus"
        ] = "allowed";
        permissionPayload[
          channel === "email" ? "emailContactStatusSource" : "smsContactStatusSource"
        ] = channel === "email"
          ? payload.emailPermissionSource
          : payload.smsPermissionSource;
        permissionPayload[
          channel === "email" ? "emailContactStatusReason" : "smsContactStatusReason"
        ] = "tenant_import";
        permissionPayload.contactPermissionUpdatedAt = channel === "email"
          ? payload.emailPermissionRecordedAt
          : payload.smsPermissionRecordedAt;
        await getRepository().updateTenant(
          saved.id,
          permissionPayload,
          current.tenant.updatedAt,
          actor.delegatedAdminUserId
        );
        await this.writeAudit(
          actor,
          actor.delegatedAdminUserId,
          "automation.permission.changed",
          "tenant",
          saved.id,
          {
            channel,
            previousStatus: previousStatus ?? "unconfirmed",
            newStatus: "allowed",
            importId: batch.id,
            rowNumber: row.rowNumber,
            evidencePresent: true
          }
        );
      }
      if (payload.schedule) {
        await this.saveDisabledSchedule(saved.id, payload.schedule, null, actor);
      }
    }
    batch.status = "completed";
    batch.committedAt = new Date().toISOString();
    return this.safeImport(batch);
  }

  async writeAudit(
    actor: AutomationActor | null,
    actorUserId: string,
    action: string,
    targetType: string,
    targetId: string | null,
    metadata: Record<string, unknown>
  ) {
    const safeMetadata = redactValue({
      ...metadata,
      requestId: actor?.requestId,
      delegatedAdminUserId: actor?.delegatedAdminUserId
    });
    if (!this.isDurable()) {
      memoryState().audit.push({
        id: crypto.randomUUID(),
        actorServiceAccountId: actor?.serviceAccountId ?? null,
        actorUserId,
        action,
        targetType,
        targetId,
        metadata: safeMetadata,
        createdAt: new Date().toISOString()
      });
      return;
    }
    const { error } = await this.client().from("audit_events").insert({
      actor_user_id: actorUserId,
      actor_service_account_id: actor?.serviceAccountId ?? null,
      request_id: actor?.requestId ?? null,
      action,
      target_type: targetType,
      target_id: targetId,
      metadata: safeMetadata
    });
    if (error) dbError(error);
  }

  async automationSummary(): Promise<{
    activeServiceAccounts: number;
    lastSuccessfulRequest: string | null;
    requestsLast24Hours: number;
    failuresLast24Hours: number;
    activeConfirmations: number;
    expiredConfirmations: number;
    unresolvedImports: number;
    health: AutomationHealth;
  }> {
    const accounts = await this.listServiceAccounts();
    if (!this.isDurable()) {
      const now = Date.now();
      return {
        activeServiceAccounts: accounts.filter((account) => account.isActive).length,
        lastSuccessfulRequest: memoryState().audit.at(-1)?.createdAt
          ? String(memoryState().audit.at(-1)?.createdAt)
          : null,
        requestsLast24Hours: memoryState().audit.filter((event) =>
          now - Date.parse(String(event.createdAt)) <= 24 * 60 * 60_000
        ).length,
        failuresLast24Hours: 0,
        activeConfirmations: memoryState().confirmations.filter((intent) => !intent.consumedAt && Date.parse(intent.expiresAt) > now).length,
        expiredConfirmations: memoryState().confirmations.filter((intent) => !intent.consumedAt && Date.parse(intent.expiresAt) <= now).length,
        unresolvedImports: memoryState().imports.filter((batch) => batch.counts.conflict > 0 || batch.counts.invalid > 0).length,
        health: await this.health()
      };
    }
    const { data, error } = await this.client().rpc("automation_admin_summary", {});
    if (error) dbError(error);
    const summary = data as Record<string, unknown>;
    return {
      activeServiceAccounts: Number(summary.activeServiceAccounts ?? 0),
      lastSuccessfulRequest: summary.lastSuccessfulRequest
        ? String(summary.lastSuccessfulRequest)
        : null,
      requestsLast24Hours: Number(summary.requestsLast24Hours ?? 0),
      failuresLast24Hours: Number(summary.failuresLast24Hours ?? 0),
      activeConfirmations: Number(summary.activeConfirmations ?? 0),
      expiredConfirmations: Number(summary.expiredConfirmations ?? 0),
      unresolvedImports: Number(summary.unresolvedImports ?? 0),
      health: await this.health()
    };
  }

  async listImportsForAdmin() {
    if (!this.isDurable()) return memoryState().imports.map((batch) => ({
      ...this.safeImport(batch),
      rawFileExpiresAt: new Date(Date.parse(batch.createdAt) + 7 * 24 * 60 * 60_000).toISOString(),
      sourceDeletedAt: (batch as TenantImportBatch & { sourceDeletedAt?: string | null }).sourceDeletedAt ?? null
    }));
    const { data, error } = await this.client()
      .from("tenant_imports")
      .select("id,job_id,source_system,import_mode,original_filename,source_digest,row_count,new_count,update_count,unchanged_count,duplicate_count,conflict_count,invalid_count,preview_version,committed_at,source_deleted_at,created_at,automation_jobs(status),automation_service_accounts(name)")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) dbError(error);
    return (data ?? []).map((item) => ({
      ...item,
      raw_file_expires_at: new Date(Date.parse(item.created_at) + 7 * 24 * 60 * 60_000).toISOString()
    }));
  }

  async tenantImportErrorReportForAdmin(id: string) {
    const batch = await this.loadImport(id);
    return {
      filename: `tenant-import-${batch.id}-errors.csv`,
      csv: createSanitizedImportErrorCsv(
        batch.rows.filter((row) =>
          row.outcome === "invalid" ||
          row.outcome === "conflict" ||
          row.errorCodes.length > 0
        )
      )
    };
  }

  async cancelTenantImportForAdmin(id: string, actorUserId: string) {
    if (!this.isDurable()) {
      const batch = await this.loadImport(id);
      if (batch.status === "completed" || batch.committedAt) {
        throw new ApiError(409, "IMPORT_ALREADY_COMMITTED", "A committed import cannot be cancelled.");
      }
      batch.status = "cancelled";
    } else {
      const { data: batch, error: readError } = await this.client()
        .from("tenant_imports")
        .select("id,job_id,committed_at")
        .eq("id", id)
        .maybeSingle();
      if (readError) dbError(readError);
      if (!batch) throw new ApiError(404, "NOT_FOUND", "Tenant import was not found.");
      if (batch.committed_at) {
        throw new ApiError(409, "IMPORT_ALREADY_COMMITTED", "A committed import cannot be cancelled.");
      }
      const { error } = await this.client()
        .from("automation_jobs")
        .update({ status: "cancelled", completed_at: new Date().toISOString() })
        .eq("id", batch.job_id)
        .in("status", ["queued", "running", "preview_ready", "awaiting_confirmation"]);
      if (error) dbError(error);
    }
    await this.writeAudit(null, actorUserId, "automation.tenant_import.cancelled", "tenant_import", id, {});
    return { id, status: "cancelled" };
  }

  async deleteTenantImportSourceForAdmin(id: string, actorUserId: string) {
    const deletedAt = new Date().toISOString();
    if (!this.isDurable()) {
      const batch = await this.loadImport(id) as TenantImportBatch & {
        sourceDeletedAt?: string | null;
      };
      batch.sourceDeletedAt = deletedAt;
    } else {
      const { data: batch, error: readError } = await this.client()
        .from("tenant_imports")
        .select("id,private_storage_path,source_deleted_at")
        .eq("id", id)
        .maybeSingle();
      if (readError) dbError(readError);
      if (!batch) throw new ApiError(404, "NOT_FOUND", "Tenant import was not found.");
      if (!batch.source_deleted_at) {
        const bucket = process.env.AUTOMATION_IMPORT_BUCKET ?? "automation-imports";
        const { error: storageError } = await this.client().storage
          .from(bucket)
          .remove([batch.private_storage_path]);
        if (storageError) {
          throw new ApiError(502, "IMPORT_STORAGE_FAILED", "The private source file could not be deleted.");
        }
        const { error } = await this.client()
          .from("tenant_imports")
          .update({ source_deleted_at: deletedAt, updated_at: deletedAt })
          .eq("id", id);
        if (error) dbError(error);
      }
    }
    await this.writeAudit(null, actorUserId, "automation.tenant_import.source_deleted", "tenant_import", id, {});
    return { id, sourceDeletedAt: deletedAt };
  }

  async listAutomationAudit() {
    if (!this.isDurable()) return structuredClone(memoryState().audit).reverse();
    const { data, error } = await this.client()
      .from("audit_events")
      .select("id,actor_user_id,actor_service_account_id,request_id,action,target_type,target_id,metadata,created_at,automation_service_accounts(name)")
      .not("actor_service_account_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) dbError(error);
    return data ?? [];
  }

  resetMemoryForTests() {
    globalThis.__tingtingAutomationMemory = undefined;
  }
}

let singleton: AutomationRepository | undefined;

export function getAutomationRepository() {
  singleton ??= new AutomationRepository();
  return singleton;
}

export function resetAutomationRepositoryForTests() {
  singleton = undefined;
  globalThis.__tingtingAutomationMemory = undefined;
}

export function permissionEligibility(tenant: Tenant, channel: "email" | "sms") {
  const destination = channel === "email" ? tenant.email : tenant.phoneE164;
  const status = channel === "email" ? tenant.emailContactStatus : tenant.smsContactStatus;
  return {
    channel,
    eligible: tenant.isActive &&
      !tenant.archivedAt &&
      Boolean(destination) &&
      status === "allowed" &&
      tenant.preferredChannels.includes(channel),
    destinationMasked: channel === "email" ? maskEmail(destination) : maskPhone(destination),
    status
  };
}

export function scheduleEligibility(
  tenant: Tenant,
  schedule: ReminderSchedule,
  templates: Awaited<ReturnType<ReturnType<typeof getRepository>["listTemplates"]>>
) {
  return schedule.channels.map((channel) => {
    const templateId = channel === "email" ? schedule.emailTemplateId : schedule.smsTemplateId;
    const template = templates.find((item) => item.id === templateId);
    const permission = permissionEligibility(tenant, channel);
    return {
      ...permission,
      templateId,
      templateName: template?.name ?? null,
      templateEligible: Boolean(template?.isActive && template.channel === channel),
      eligible: permission.eligible && Boolean(template?.isActive && template.channel === channel)
    };
  });
}
