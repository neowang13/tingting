import { sectionKeySchema } from "@/features/content/schemas";
import { handleApiError, ok, readJson, ApiError } from "@/lib/api";
import {
  assertRecentAal2,
  assertRecentAuthentication,
  assertSameOrigin,
  requireAdminRequest
} from "@/lib/auth";
import { getRepository } from "@/data/repository";
import { pauseInputSchema } from "@/lib/schemas";
import { assertActionRateLimit } from "@/lib/rate-limit";
import { getAutomationRepository } from "@/data/automation-repository";
import {
  serviceAccountCreateSchema,
  serviceAccountUpdateSchema,
  tokenRevokeSchema,
  tokenRotationSchema
} from "@/features/automation/schemas";

interface Context {
  params: Promise<{ segments: string[] }>;
}

async function prepare(request: Request, context: Context) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const admin = await requireAdminRequest(request);
  const { segments } = await context.params;
  return { requestId, admin, segments };
}

function routeNotFound(): never {
  throw new ApiError(404, "ROUTE_NOT_FOUND", "The API route was not found.");
}

export async function GET(request: Request, context: Context) {
  let requestId = crypto.randomUUID();
  try {
    const prepared = await prepare(request, context);
    requestId = prepared.requestId;
    const [resource, id, action] = prepared.segments;
    const repository = getRepository();

    if (resource === "dashboard" && !id) return ok(await repository.dashboard(), requestId);
    if (resource === "sections" && !id) return ok(await repository.listSections(), requestId);
    if (resource === "sections" && id && !action) {
      return ok(await repository.getSection(sectionKeySchema.parse(id)), requestId);
    }
    if (resource === "sections" && id && action === "revisions") {
      return ok(await repository.listSectionRevisions(sectionKeySchema.parse(id)), requestId);
    }
    if (resource === "rentals" && !id) return ok(await repository.listRentals(), requestId);
    if (resource === "rentals" && id && !action) return ok(await repository.getRental(id), requestId);
    if (resource === "tenants" && !id) return ok(await repository.listTenants(), requestId);
    if (resource === "tenants" && id && !action) return ok(await repository.getTenant(id), requestId);
    if (resource === "templates" && !id) return ok(await repository.listTemplates(), requestId);
    if (resource === "notifications" && id === "events" && !action) {
      return ok(await repository.listEvents(), requestId);
    }
    if (resource === "settings" && id === "reminders" && !action) {
      return ok(await repository.getPause(), requestId);
    }
    if (resource === "settings" && id === "test-contacts" && !action) {
      return ok(await repository.getTestContacts(), requestId);
    }
    if (resource === "automation" && id === "summary" && !action) {
      return ok(await getAutomationRepository().automationSummary(), requestId);
    }
    if (resource === "automation" && id === "service-accounts" && !action) {
      return ok(await getAutomationRepository().listServiceAccounts(), requestId);
    }
    if (resource === "automation" && id === "imports" && !action) {
      return ok(await getAutomationRepository().listImportsForAdmin(), requestId);
    }
    if (
      resource === "automation" &&
      id === "imports" &&
      action &&
      prepared.segments[3] === "errors.csv"
    ) {
      const report = await getAutomationRepository().tenantImportErrorReportForAdmin(action);
      return new Response(report.csv, {
        status: 200,
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="${report.filename}"`,
          "cache-control": "private, no-store",
          "x-request-id": requestId
        }
      });
    }
    if (resource === "automation" && id === "audit" && !action) {
      return ok(await getAutomationRepository().listAutomationAudit(), requestId);
    }
    routeNotFound();
  } catch (error) {
    return handleApiError(error, requestId);
  }
}

export async function POST(request: Request, context: Context) {
  let requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const prepared = await prepare(request, context);
    requestId = prepared.requestId;
    const [resource, id, action, nested] = prepared.segments;
    const body = await readJson(request);
    const repository = getRepository();
    const actorId = prepared.admin.userId;

    if (resource === "sections" && id && action === "publish") {
      await assertActionRateLimit(actorId, "section-publish", 20, 60);
      const payload = body as { expectedVersion?: unknown };
      return ok(
        await repository.publishSection(sectionKeySchema.parse(id), payload.expectedVersion, actorId),
        requestId
      );
    }
    if (
      resource === "automation" &&
      id === "imports" &&
      action &&
      nested === "cancel"
    ) {
      assertRecentAal2(prepared.admin);
      await assertActionRateLimit(actorId, "automation-import-cancel", 10, 60 * 60);
      return ok(
        await getAutomationRepository().cancelTenantImportForAdmin(action, actorId),
        requestId
      );
    }
    if (
      resource === "automation" &&
      id === "imports" &&
      action &&
      nested === "delete-source"
    ) {
      assertRecentAal2(prepared.admin);
      await assertActionRateLimit(actorId, "automation-import-source-delete", 10, 60 * 60);
      return ok(
        await getAutomationRepository().deleteTenantImportSourceForAdmin(action, actorId),
        requestId
      );
    }
    if (resource === "sections" && id && action === "rollback") {
      const payload = body as { revisionId?: unknown; expectedVersion?: unknown };
      return ok(
        await repository.rollbackSection(
          sectionKeySchema.parse(id),
          payload.revisionId,
          payload.expectedVersion,
          actorId
        ),
        requestId
      );
    }
    if (resource === "rentals" && !id) return ok(await repository.createRental(body, actorId), requestId, 201);
    if (resource === "rentals" && id && ["publish", "unpublish", "archive"].includes(action ?? "")) {
      const payload = body as { expectedVersion?: unknown };
      return ok(
        await repository.setRentalStatus(
          id,
          action as "publish" | "unpublish" | "archive",
          payload.expectedVersion,
          actorId
        ),
        requestId
      );
    }
    if (resource === "tenants" && !id) return ok(await repository.createTenant(body, actorId), requestId, 201);
    if (resource === "tenants" && id && action === "archive") {
      const payload = body as { expectedVersion?: unknown };
      return ok(await repository.archiveTenant(id, payload.expectedVersion, actorId), requestId);
    }
    if (resource === "tenants" && id && action === "schedule") {
      const payload = body as { schedule?: unknown; expectedVersion?: unknown };
      return ok(await repository.saveSchedule(id, payload.schedule, payload.expectedVersion, actorId), requestId);
    }
    if (resource === "templates" && !id) return ok(await repository.createTemplate(body, actorId), requestId, 201);
    if (resource === "notifications" && id === "preview") {
      return ok(await repository.previewNotification(body), requestId);
    }
    if (resource === "notifications" && id === "test") {
      assertRecentAuthentication(prepared.admin);
      await assertActionRateLimit(actorId, "notification-test", 5, 10 * 60);
      return ok(await repository.createTestEvent(body, actorId), requestId, 201);
    }
    if (resource === "notifications" && id === "batches" && !action) {
      return ok(await repository.createBatch(body, actorId), requestId, 201);
    }
    if (resource === "notifications" && id === "batches" && action && nested === "confirm") {
      assertRecentAuthentication(prepared.admin);
      await assertActionRateLimit(actorId, "notification-batch-confirm", 3, 10 * 60);
      return ok(await repository.confirmBatch(action, body, actorId), requestId);
    }
    if (resource === "notifications" && id === "events" && action && nested === "retry") {
      assertRecentAuthentication(prepared.admin);
      return ok(await repository.retryEvent(action, actorId), requestId, 201);
    }
    if (resource === "automation" && id === "service-accounts" && !action) {
      assertRecentAal2(prepared.admin);
      await assertActionRateLimit(actorId, "automation-service-account-create", 5, 60 * 60);
      const input = serviceAccountCreateSchema.parse(body);
      return ok(
        await getAutomationRepository().createServiceAccount(input, actorId),
        requestId,
        201
      );
    }
    if (
      resource === "automation" &&
      id === "service-accounts" &&
      action &&
      nested === "tokens" &&
      prepared.segments[4] &&
      prepared.segments[5] === "revoke"
    ) {
      assertRecentAal2(prepared.admin);
      await assertActionRateLimit(actorId, "automation-token-revoke", 10, 60 * 60);
      tokenRevokeSchema.parse(body);
      await getAutomationRepository().revokeToken(
        action,
        prepared.segments[4],
        actorId
      );
      return ok({ revoked: true }, requestId);
    }
    if (
      resource === "automation" &&
      id === "service-accounts" &&
      action &&
      nested === "tokens"
    ) {
      assertRecentAal2(prepared.admin);
      await assertActionRateLimit(actorId, "automation-token-rotate", 5, 60 * 60);
      const input = tokenRotationSchema.parse(body);
      return ok(
        await getAutomationRepository().rotateToken(action, input, actorId),
        requestId,
        201
      );
    }
    routeNotFound();
  } catch (error) {
    return handleApiError(error, requestId);
  }
}

export async function PATCH(request: Request, context: Context) {
  let requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const prepared = await prepare(request, context);
    requestId = prepared.requestId;
    const [resource, id, action] = prepared.segments;
    const body = (await readJson(request)) as Record<string, unknown>;
    const repository = getRepository();
    const actorId = prepared.admin.userId;

    if (resource === "sections" && id && !action) {
      return ok(
        await repository.saveSectionDraft(
          sectionKeySchema.parse(id),
          body.content,
          body.expectedVersion,
          actorId
        ),
        requestId
      );
    }
    if (resource === "rentals" && id && !action) {
      return ok(await repository.updateRental(id, body.rental, body.expectedVersion, actorId), requestId);
    }
    if (resource === "tenants" && id && !action) {
      return ok(await repository.updateTenant(id, body.tenant, body.expectedVersion, actorId), requestId);
    }
    if (resource === "templates" && id && !action) {
      return ok(await repository.updateTemplate(id, body.template, body.expectedVersion, actorId), requestId);
    }
    if (resource === "settings" && id === "reminders" && !action) {
      assertRecentAuthentication(prepared.admin);
      const input = pauseInputSchema.parse(body);
      return ok(await repository.setPause(input.paused, input.expectedVersion, actorId), requestId);
    }
    if (resource === "settings" && id === "test-contacts" && !action) {
      assertRecentAuthentication(prepared.admin);
      return ok(await repository.setTestContacts(body, actorId), requestId);
    }
    if (resource === "automation" && id === "service-accounts" && action) {
      assertRecentAal2(prepared.admin);
      await assertActionRateLimit(actorId, "automation-service-account-update", 10, 60 * 60);
      const input = serviceAccountUpdateSchema.parse(body);
      return ok(
        await getAutomationRepository().updateServiceAccount(action, input, actorId),
        requestId
      );
    }
    routeNotFound();
  } catch (error) {
    return handleApiError(error, requestId);
  }
}
