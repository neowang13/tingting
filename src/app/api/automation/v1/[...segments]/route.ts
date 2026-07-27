import { getAutomationRepository, scheduleEligibility } from "@/data/automation-repository";
import { getRepository } from "@/data/repository";
import { validateAutomationToken, parseAutomationToken } from "@/features/automation/auth";
import { assertConfirmationExecutable, sha256Digest } from "@/features/automation/confirmations";
import type {
  AutomationActor,
  AutomationConfirmationAction,
  TenantImportOutcome
} from "@/features/automation/contracts";
import { withAutomationIdempotency } from "@/features/automation/idempotency";
import { safeAutomationLog } from "@/features/automation/redaction";
import {
  confirmationActionScopes,
  assertAutomationScope,
  routeScopes,
  type AutomationRouteName
} from "@/features/automation/scopes";
import {
  automationRentalInputSchema,
  automationTenantInputSchema,
  confirmationExecutionSchema,
  cursorSchema,
  disabledScheduleInputSchema,
  importCommitPreviewSchema,
  importModeSchema,
  limitSchema,
  permissionPreviewSchema,
  rentalStatusPreviewSchema,
  rentalUpdateSchema,
  requestIdSchema,
  scheduleSaveSchema,
  scheduleStatusPreviewSchema,
  tenantUpdateSchema
} from "@/features/automation/schemas";
import { nextOccurrence } from "@/features/reminders/scheduler";
import { ApiError, handleApiError, readJson } from "@/lib/api";
import { readServerEnvironment } from "@/lib/env";
import { NextResponse } from "next/server";

interface Context {
  params: Promise<{ segments: string[] }>;
}

function success(data: unknown, requestId: string, status = 200, headers?: HeadersInit) {
  return NextResponse.json(
    { success: true, data, requestId },
    { status, headers }
  );
}

function requestIdFor(request: Request) {
  const supplied = request.headers.get("x-request-id");
  return supplied && requestIdSchema.safeParse(supplied).success ? supplied : crypto.randomUUID();
}

async function authenticate(request: Request, requestId: string) {
  const environment = readServerEnvironment(process.env, { fresh: true });
  if (environment.AUTOMATION_API_ENABLED !== "true") {
    throw new ApiError(503, "AUTOMATION_DISABLED", "The Automation API is disabled.");
  }
  if (
    process.env.NODE_ENV === "production" &&
    new URL(request.url).protocol !== "https:" &&
    request.headers.get("x-forwarded-proto") !== "https"
  ) {
    throw new ApiError(400, "HTTPS_REQUIRED", "Automation requests require HTTPS.");
  }
  const parsed = parseAutomationToken(request.headers.get("authorization"));
  const repository = getAutomationRepository();
  const lookup = await repository.lookupToken(parsed.prefix);
  return validateAutomationToken(
    parsed.token,
    lookup,
    environment.AUTOMATION_TOKEN_PEPPER ??
      "local-demo-only-automation-pepper-not-for-production",
    requestId
  );
}

function assertMutationAvailable(feature: "mutations" | "confirmations" | "tenantImport" = "mutations") {
  const environment = readServerEnvironment(process.env, { fresh: true });
  const enabled = feature === "mutations"
    ? environment.AUTOMATION_MUTATIONS_ENABLED
    : feature === "confirmations"
      ? environment.AUTOMATION_CONFIRMATIONS_ENABLED
      : environment.AUTOMATION_TENANT_IMPORT_ENABLED;
  if (enabled !== "true") throw new ApiError(503, "AUTOMATION_DISABLED", `Automation ${feature} are disabled.`);
  if (process.env.NODE_ENV === "production" && environment.DATA_BACKEND !== "supabase") {
    throw new ApiError(503, "DURABLE_BACKEND_REQUIRED", "Production automation mutations require Supabase.");
  }
}

function authorize(actor: AutomationActor, routeName: AutomationRouteName) {
  assertAutomationScope(actor.scopes, routeScopes[routeName]);
}

function publicTenantResult(tenant: Awaited<ReturnType<ReturnType<typeof getAutomationRepository>["saveTenant"]>>) {
  return {
    id: tenant.id,
    fullName: tenant.fullName,
    propertyLabel: tenant.propertyLabel,
    unitLabel: tenant.unitLabel,
    emailMasked: tenant.email ? `${tenant.email.slice(0, 1)}***@${tenant.email.split("@")[1]}` : null,
    phoneMasked: tenant.phoneE164 ? `${tenant.phoneE164.slice(0, 3)}***${tenant.phoneE164.slice(-2)}` : null,
    preferredChannels: tenant.preferredChannels,
    emailContactStatus: tenant.emailContactStatus,
    smsContactStatus: tenant.smsContactStatus,
    timezone: tenant.timezone,
    isActive: tenant.isActive,
    sourceSystem: tenant.sourceSystem,
    externalReference: tenant.externalReference,
    updatedAt: tenant.updatedAt
  };
}

async function idempotent<T>(
  request: Request,
  actor: AutomationActor,
  bodyDigest: string,
  operation: () => Promise<{
    status: number;
    data: T;
    resourceType?: string;
    resourceId?: string;
    resourceVersion?: string | null;
  }>
) {
  return withAutomationIdempotency(
    getAutomationRepository(),
    {
      serviceAccountId: actor.serviceAccountId,
      key: request.headers.get("idempotency-key"),
      method: request.method,
      path: new URL(request.url).pathname,
      contentType: request.headers.get("content-type") ?? "application/json",
      bodyDigest
    },
    operation
  );
}

function queryInput(request: Request) {
  const url = new URL(request.url);
  return {
    q: url.searchParams.get("q")?.slice(0, 120) || undefined,
    property: url.searchParams.get("property")?.slice(0, 160) || undefined,
    status: url.searchParams.get("status") || undefined,
    outcome: url.searchParams.get("outcome") || undefined,
    limit: limitSchema.parse(url.searchParams.get("limit") ?? undefined),
    cursor: cursorSchema.parse(url.searchParams.get("cursor") ?? undefined)
  };
}

export async function GET(request: Request, context: Context) {
  const started = Date.now();
  const requestId = requestIdFor(request);
  let actor: AutomationActor | undefined;
  let routeName: AutomationRouteName | undefined;
  let outcome: "completed" | "failed" = "completed";
  try {
    actor = await authenticate(request, requestId);
    const { segments } = await context.params;
    const [resource, id, action] = segments;
    const repository = getAutomationRepository();
    const query = queryInput(request);

    if (resource === "health" && !id) {
      routeName = "health";
      authorize(actor, routeName);
      return success(await repository.health(), requestId);
    }
    if (resource === "rentals" && !id) {
      routeName = "rentals.list";
      authorize(actor, routeName);
      if (query.status && !["draft", "published", "archived"].includes(query.status)) {
        throw new ApiError(422, "VALIDATION_ERROR", "The rental status filter is invalid.");
      }
      return success(await repository.listRentals(query), requestId);
    }
    if (resource === "rentals" && id && !action) {
      routeName = "rentals.get";
      authorize(actor, routeName);
      return success(await repository.getRental(id), requestId);
    }
    if (resource === "tenants" && !id) {
      routeName = "tenants.list";
      authorize(actor, routeName);
      return success(await repository.listTenants(query), requestId);
    }
    if (resource === "tenants" && id && !action) {
      routeName = "tenants.get";
      authorize(actor, routeName);
      return success(await repository.getTenant(id), requestId);
    }
    if (resource === "tenants" && id && action === "schedule") {
      routeName = "schedules.get";
      authorize(actor, routeName);
      const current = await getRepository().getTenant(id);
      const candidateNextRunAt = current.schedule
        ? nextOccurrence({
            dayOfMonth: current.schedule.dayOfMonth,
            localTime: current.schedule.localTime,
            timezone: current.schedule.timezone,
            afterInstant: new Date().toISOString()
          })
        : null;
      return success({
        schedule: current.schedule,
        candidateNextRunAt,
        eligibility: current.schedule
          ? scheduleEligibility(current.tenant, current.schedule, await getRepository().listTemplates())
          : []
      }, requestId);
    }
    if (resource === "tenant-imports" && id && !action) {
      routeName = "imports.get";
      authorize(actor, routeName);
      return success(await repository.getTenantImport(id, actor), requestId);
    }
    if (resource === "tenant-imports" && id && action === "rows") {
      routeName = "imports.rows";
      authorize(actor, routeName);
      if (
        query.outcome &&
        !["new", "update", "unchanged", "duplicate", "conflict", "invalid"].includes(query.outcome)
      ) {
        throw new ApiError(422, "VALIDATION_ERROR", "The import outcome filter is invalid.");
      }
      return success(await repository.listTenantImportRows(id, actor, {
        outcome: query.outcome as TenantImportOutcome | undefined,
        limit: query.limit,
        cursor: query.cursor
      }), requestId);
    }
    if (resource === "jobs" && id && !action) {
      routeName = "jobs.get";
      authorize(actor, routeName);
      return success(await repository.getJob(id, actor), requestId);
    }
    throw new ApiError(404, "ROUTE_NOT_FOUND", "The Automation API route was not found.");
  } catch (error) {
    outcome = "failed";
    return handleApiError(error, requestId);
  } finally {
    safeAutomationLog({
      requestId,
      serviceAccountId: actor?.serviceAccountId,
      routeName,
      method: request.method,
      status: outcome,
      durationMs: Date.now() - started
    });
  }
}

export async function POST(request: Request, context: Context) {
  const started = Date.now();
  const requestId = requestIdFor(request);
  let actor: AutomationActor | undefined;
  let routeName: AutomationRouteName | undefined;
  let outcome: "completed" | "failed" = "completed";
  try {
    actor = await authenticate(request, requestId);
    const { segments } = await context.params;
    const [resource, id, action] = segments;
    const repository = getAutomationRepository();

    if (resource === "media" && !id) {
      routeName = "media.upload";
      authorize(actor, routeName);
      assertMutationAvailable();
      const form = await request.formData();
      const file = form.get("file");
      const altText = form.get("altText");
      if (!(file instanceof File) || typeof altText !== "string") {
        throw new ApiError(400, "INVALID_MULTIPART", "A file and altText are required.");
      }
      const digest = sha256Digest(new Uint8Array(await file.arrayBuffer()));
      const result = await idempotent(request, actor, digest, async () => {
        const asset = await repository.uploadMedia(file, altText, actor!);
        return {
          status: 201,
          data: asset,
          resourceType: "media_asset",
          resourceId: asset.id
        };
      });
      return success(result.data, requestId, result.status);
    }
    if (resource === "tenant-imports" && !id) {
      routeName = "imports.create";
      authorize(actor, routeName);
      assertMutationAvailable("tenantImport");
      assertMutationAvailable();
      const form = await request.formData();
      const file = form.get("file");
      const mode = importModeSchema.parse(form.get("mode"));
      const sourceSystem = String(form.get("sourceSystem") ?? "").trim();
      if (!(file instanceof File) || !sourceSystem || sourceSystem.length > 60) {
        throw new ApiError(400, "INVALID_MULTIPART", "A file, mode, and sourceSystem are required.");
      }
      const digest = sha256Digest(new Uint8Array(await file.arrayBuffer()));
      const result = await idempotent(request, actor, digest, async () => {
        const batch = await repository.createTenantImport(file, mode, sourceSystem, actor!);
        return {
          status: 202,
          data: batch,
          resourceType: "tenant_import",
          resourceId: batch.id,
          resourceVersion: batch.previewVersion
        };
      });
      return success(result.data, requestId, result.status);
    }

    const rawBody = await readJson(request);
    const bodyDigest = sha256Digest(rawBody);

    if (resource === "rentals" && !id) {
      routeName = "rentals.create";
      authorize(actor, routeName);
      assertMutationAvailable();
      const input = automationRentalInputSchema.parse(rawBody);
      const result = await idempotent(request, actor, bodyDigest, async () => {
        const rental = await repository.saveRentalDraft(null, input, null, actor!);
        return {
          status: 201,
          data: rental,
          resourceType: "rental_listing",
          resourceId: rental.id,
          resourceVersion: rental.updatedAt
        };
      });
      return success(result.data, requestId, result.status, {
        Location: `/api/automation/v1/rentals/${(result.data as { id: string }).id}`
      });
    }
    if (resource === "tenants" && !id) {
      routeName = "tenants.create";
      authorize(actor, routeName);
      assertMutationAvailable();
      const input = automationTenantInputSchema.parse(rawBody);
      const result = await idempotent(request, actor, bodyDigest, async () => {
        const tenant = await repository.saveTenant(null, input, null, actor!);
        return {
          status: 201,
          data: publicTenantResult(tenant),
          resourceType: "tenant",
          resourceId: tenant.id,
          resourceVersion: tenant.updatedAt
        };
      });
      return success(result.data, requestId, result.status);
    }
    if (resource === "rentals" && id && action === "status-previews") {
      routeName = "rentals.statusPreview";
      authorize(actor, routeName);
      assertMutationAvailable("confirmations");
      const input = rentalStatusPreviewSchema.parse(rawBody);
      const result = await idempotent(request, actor, bodyDigest, async () => {
        const rental = await repository.getRental(id);
        if (rental.updatedAt !== input.expectedVersion) {
          throw new ApiError(409, "VERSION_CONFLICT", "The rental changed after it was loaded.");
        }
        if (input.action === "publish") {
          if (rental.status !== "draft") {
            throw new ApiError(422, "RENTAL_STATUS_INVALID", "Only a draft rental can be published.");
          }
          if (rental.images.length < 1 || rental.images.length > 20) {
            throw new ApiError(422, "RENTAL_MEDIA_INVALID", "Publication requires 1 to 20 images.");
          }
          if (rental.images.filter((image) => image.isCover).length !== 1) {
            throw new ApiError(422, "RENTAL_COVER_INVALID", "Publication requires exactly one cover image.");
          }
          if (rental.images.some((image) => !image.alt || image.alt.length > 160)) {
            throw new ApiError(422, "RENTAL_MEDIA_INVALID", "Every image requires valid alt text.");
          }
        }
        const confirmation = await repository.createConfirmation({
          actor: actor!,
          action: `rental.${input.action}` as AutomationConfirmationAction,
          targetType: "rental_listing",
          targetId: rental.id,
          targetVersion: rental.updatedAt,
          payload: { action: input.action },
          summary: {
            title: `${input.action[0].toUpperCase()}${input.action.slice(1)} ${rental.title}`,
            effects: [
              input.action === "publish"
                ? "The listing becomes publicly visible."
                : input.action === "unpublish"
                  ? "The listing is removed from public results and returned to draft."
                  : "The listing is removed from public results and cannot be restored in v1."
            ],
            warnings: []
          },
          requiredAcknowledgements: [input.action === "publish" ? "public_visibility" : "status_change_reviewed"]
        });
        return {
          status: 201,
          data: { confirmation },
          resourceType: "automation_confirmation",
          resourceId: confirmation.id
        };
      });
      return success(result.data, requestId, result.status);
    }
    if (resource === "tenants" && id && action === "permission-previews") {
      routeName = "tenants.permissionPreview";
      authorize(actor, routeName);
      assertMutationAvailable("confirmations");
      const input = permissionPreviewSchema.parse(rawBody);
      const result = await idempotent(request, actor, bodyDigest, async () => {
        const current = await getRepository().getTenant(id);
        if (current.tenant.updatedAt !== input.expectedVersion) {
          throw new ApiError(409, "VERSION_CONFLICT", "The tenant changed after it was loaded.");
        }
        const confirmation = await repository.createConfirmation({
          actor: actor!,
          action: "tenant.permission.grant",
          targetType: "tenant",
          targetId: id,
          targetVersion: current.tenant.updatedAt,
          payload: input,
          summary: {
            title: `Grant ${input.channel} reminder permission`,
            effects: [`The tenant's ${input.channel} contact status becomes allowed.`],
            warnings: ["Permission evidence is recorded by reference; the evidence document is not copied."]
          },
          requiredAcknowledgements: ["permission_evidence_reviewed"]
        });
        return { status: 201, data: { confirmation } };
      });
      return success(result.data, requestId, result.status);
    }
    if (resource === "tenant-imports" && id && action === "commit-previews") {
      routeName = "imports.commitPreview";
      authorize(actor, routeName);
      assertMutationAvailable("confirmations");
      assertMutationAvailable("tenantImport");
      const input = importCommitPreviewSchema.parse(rawBody);
      const result = await idempotent(request, actor, bodyDigest, async () => {
        const batch = await repository.getTenantImport(id, actor!);
        if (
          batch.sourceDigest !== input.expectedSourceDigest ||
          batch.previewVersion !== input.expectedPreviewVersion
        ) throw new ApiError(409, "PREVIEW_STALE", "The import preview changed.");
        if (batch.counts.invalid > 0 || batch.counts.conflict > 0) {
          throw new ApiError(409, "IMPORT_HAS_ERRORS", "Resolve invalid and conflict rows before commit.");
        }
        const permissionGrantCount = await repository.tenantImportPermissionGrantCount(id, actor!);
        if (permissionGrantCount > 0) {
          assertAutomationScope(actor!.scopes, "permissions:grant");
        }
        const confirmation = await repository.createConfirmation({
          actor: actor!,
          action: "tenant_import.commit",
          targetType: "tenant_import",
          targetId: id,
          targetVersion: batch.previewVersion,
          payload: {
            sourceDigest: batch.sourceDigest,
            counts: batch.counts,
            permissionGrantCount
          },
          summary: {
            title: `Commit tenant import ${batch.originalFilename}`,
            effects: [
              `Create ${batch.counts.new} tenant records.`,
              `Update ${batch.counts.update} tenant records.`,
              `Grant ${permissionGrantCount} evidenced contact permissions.`,
              "All imported reminder schedules remain disabled."
            ],
            warnings: batch.counts.duplicate > 0
              ? [`${batch.counts.duplicate} duplicate rows will not be written.`]
              : []
          },
          requiredAcknowledgements: ["tenant_import_counts_reviewed", "permission_grants_reviewed"]
        });
        return { status: 201, data: { confirmation } };
      });
      return success(result.data, requestId, result.status);
    }
    if (resource === "tenants" && id && action === "schedule-status-previews") {
      routeName = "schedules.statusPreview";
      authorize(actor, routeName);
      assertMutationAvailable("confirmations");
      const input = scheduleStatusPreviewSchema.parse(rawBody);
      const result = await idempotent(request, actor, bodyDigest, async () => {
        const current = await getRepository().getTenant(id);
        if (!current.schedule || current.schedule.updatedAt !== input.expectedVersion) {
          throw new ApiError(409, "VERSION_CONFLICT", "The schedule changed after it was loaded.");
        }
        const templates = await getRepository().listTemplates();
        const eligibility = scheduleEligibility(current.tenant, current.schedule, templates);
        if (input.enabled && eligibility.some((item) => !item.eligible)) {
          throw new ApiError(422, "CHANNEL_INELIGIBLE", "One or more selected channels are not eligible.", {
            channels: eligibility.map((item) => ({
              channel: item.channel,
              eligible: item.eligible,
              status: item.status
            }))
          });
        }
        const health = await repository.health();
        const nextRunAt = nextOccurrence({
          dayOfMonth: current.schedule.dayOfMonth,
          localTime: current.schedule.localTime,
          timezone: current.schedule.timezone,
          afterInstant: new Date().toISOString()
        });
        const requiredAcknowledgements = [
          "schedule_configuration_reviewed",
          "selected_recipients_and_channels_reviewed"
        ];
        if (
          (health.emailProviderMode === "live" || health.smsProviderMode === "live") &&
          !health.remindersForcePaused &&
          !health.remindersGlobalPaused
        ) requiredAcknowledgements.push("real_delivery_warning");
        const confirmation = await repository.createConfirmation({
          actor: actor!,
          action: input.enabled ? "schedule.enable" : "schedule.disable",
          targetType: "reminder_schedule",
          targetId: id,
          targetVersion: current.schedule.updatedAt,
          payload: { enabled: input.enabled, nextRunAt, eligibility },
          summary: {
            title: `${input.enabled ? "Enable" : "Disable"} monthly reminder schedule`,
            effects: [
              input.enabled
                ? `The existing reminder worker will evaluate this schedule. Next candidate: ${nextRunAt}.`
                : "Future occurrences will no longer be materialized."
            ],
            warnings: health.effectiveReminderPause ||
              (health.emailProviderMode !== "live" && health.smsProviderMode !== "live")
              ? ["Real delivery remains blocked by the current pause/provider safety state."]
              : ["Real delivery is active after confirmation."]
          },
          requiredAcknowledgements
        });
        return { status: 201, data: { confirmation, eligibility, health } };
      });
      return success(result.data, requestId, result.status);
    }
    if (resource === "confirmations" && id && action === "execute") {
      routeName = "confirmations.execute";
      authorize(actor, routeName);
      assertMutationAvailable("confirmations");
      assertMutationAvailable();
      const input = confirmationExecutionSchema.parse(rawBody);
      const intent = await repository.getConfirmation(id);
      assertAutomationScope(actor.scopes, confirmationActionScopes[intent.action]);
      assertConfirmationExecutable(intent, actor.serviceAccountId, input.digest, input.acknowledged);
      const result = await idempotent(request, actor, bodyDigest, async () => ({
        status: 200,
        data: await repository.executeConfirmation(
          intent,
          request.headers.get("idempotency-key")!,
          actor!
        ),
        resourceType: intent.targetType,
        resourceId: intent.targetId
      }));
      return success(result.data, requestId, result.status);
    }
    throw new ApiError(404, "ROUTE_NOT_FOUND", "The Automation API route was not found.");
  } catch (error) {
    outcome = "failed";
    return handleApiError(error, requestId);
  } finally {
    safeAutomationLog({
      requestId,
      serviceAccountId: actor?.serviceAccountId,
      routeName,
      method: request.method,
      status: outcome,
      durationMs: Date.now() - started
    });
  }
}

export async function PATCH(request: Request, context: Context) {
  const requestId = requestIdFor(request);
  try {
    const actor = await authenticate(request, requestId);
    const { segments } = await context.params;
    const [resource, id, action] = segments;
    if (!id || action) throw new ApiError(404, "ROUTE_NOT_FOUND", "The Automation API route was not found.");
    assertMutationAvailable();
    const rawBody = await readJson(request);
    const bodyDigest = sha256Digest(rawBody);
    const repository = getAutomationRepository();
    if (resource === "rentals") {
      authorize(actor, "rentals.update");
      const input = rentalUpdateSchema.parse(rawBody);
      const result = await idempotent(request, actor, bodyDigest, async () => {
        const rental = await repository.saveRentalDraft(id, input.rental, input.expectedVersion, actor);
        return {
          status: 200,
          data: rental,
          resourceType: "rental_listing",
          resourceId: rental.id,
          resourceVersion: rental.updatedAt
        };
      });
      return success(result.data, requestId, result.status);
    }
    if (resource === "tenants") {
      authorize(actor, "tenants.update");
      const input = tenantUpdateSchema.parse(rawBody);
      const result = await idempotent(request, actor, bodyDigest, async () => {
        const tenant = await repository.saveTenant(id, input.tenant, input.expectedVersion, actor);
        return {
          status: 200,
          data: publicTenantResult(tenant),
          resourceType: "tenant",
          resourceId: tenant.id,
          resourceVersion: tenant.updatedAt
        };
      });
      return success(result.data, requestId, result.status);
    }
    throw new ApiError(404, "ROUTE_NOT_FOUND", "The Automation API route was not found.");
  } catch (error) {
    return handleApiError(error, requestId);
  }
}

export async function PUT(request: Request, context: Context) {
  const requestId = requestIdFor(request);
  try {
    const actor = await authenticate(request, requestId);
    const { segments } = await context.params;
    const [resource, tenantId, action] = segments;
    if (resource !== "tenants" || !tenantId || action !== "schedule") {
      throw new ApiError(404, "ROUTE_NOT_FOUND", "The Automation API route was not found.");
    }
    authorize(actor, "schedules.save");
    assertMutationAvailable();
    const rawBody = await readJson(request);
    const input = scheduleSaveSchema.parse(rawBody);
    disabledScheduleInputSchema.parse(input.schedule);
    const result = await idempotent(request, actor, sha256Digest(rawBody), async () => {
      const schedule = await getAutomationRepository().saveDisabledSchedule(
        tenantId,
        input.schedule,
        input.expectedVersion,
        actor
      );
      return {
        status: 200,
        data: schedule,
        resourceType: "reminder_schedule",
        resourceId: schedule.id,
        resourceVersion: schedule.updatedAt
      };
    });
    return success(result.data, requestId, result.status);
  } catch (error) {
    return handleApiError(error, requestId);
  }
}
