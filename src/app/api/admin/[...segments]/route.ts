import { sectionKeySchema } from "@/features/content/schemas";
import { handleApiError, ok, readJson, ApiError } from "@/lib/api";
import {
  assertRecentAal2,
  assertRecentAuthentication,
  assertSameOrigin,
  requireAdminRequest
} from "@/lib/auth";
import { getRepository } from "@/data/repository";
import {
  businessNameSettingsInputSchema,
  clientUserIdSchema,
  pauseInputSchema,
  reminderSettingsInputSchema,
  notificationEventFilterSchema,
  schedulePreviewSchema,
  tenantCreateInputSchema,
  tenantListFilterSchema,
  testNotificationConfirmationSchema,
  testNotificationSchema
} from "@/lib/schemas";
import {
  previewReminderOccurrence
} from "@/features/reminders/scheduler";
import {
  estimateSmsSegments,
  renderTemplate,
  type TemplateContext
} from "@/features/notifications/template-renderer";
import type { TenantListFilters } from "@/lib/contracts";
import { assertActionRateLimit } from "@/lib/rate-limit";
import {
  createTestSendPreviewToken,
  verifyTestSendPreviewToken
} from "@/features/notifications/test-send-preview";
import {
  deliverOwnerNotifications,
  enqueueTenantUploadNotification
} from "@/features/notifications/owner-notifications";
import {
  formatRentDueDate
} from "@/features/reminders/due-date";
import { attemptImmediateReminderCatchUp } from "@/features/reminders/catch-up";
import { getAutomationRepository } from "@/data/automation-repository";
import {
  serviceAccountCreateSchema,
  serviceAccountUpdateSchema,
  tokenRevokeSchema,
  tokenRotationSchema
} from "@/features/automation/schemas";
import {
  getViewingSchedule,
  saveViewingSchedule,
  type ViewingScheduleInput
} from "@/features/showings/availability";

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

function rejectDisabledAdminAutomation(resource: string | undefined) {
  if (resource === "automation" && process.env.AUTOMATION_API_ENABLED !== "true") {
    routeNotFound();
  }
}

export async function GET(request: Request, context: Context) {
  let requestId = crypto.randomUUID();
  try {
    const prepared = await prepare(request, context);
    requestId = prepared.requestId;
    const [resource, id, action] = prepared.segments;
    rejectDisabledAdminAutomation(resource);
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
    if (resource === "tenants" && !id) {
      const url = new URL(request.url);
      const filters: TenantListFilters = tenantListFilterSchema.parse({
        query: url.searchParams.get("q") || undefined,
        lifecycle: url.searchParams.get("lifecycle") || undefined,
        contact: url.searchParams.get("contact") || undefined,
        schedule: url.searchParams.get("schedule") || undefined,
        rentStatus: url.searchParams.get("rent") || undefined,
        leaseType: url.searchParams.get("lease") || undefined,
        limit: 500
      });
      return ok(await repository.listTenants(filters), requestId);
    }
    if (resource === "tenants" && id && !action) return ok(await repository.getTenant(id), requestId);
    if (resource === "clients" && !id) return ok(await repository.listClientAccounts(), requestId);
    if (resource === "templates" && !id) return ok(await repository.listTemplates(), requestId);
    if (resource === "notifications" && id === "events" && !action) {
      const url = new URL(request.url);
      const filters = notificationEventFilterSchema.parse({
        tenantId: url.searchParams.get("tenantId") || undefined,
        channel: url.searchParams.get("channel") || undefined,
        status: url.searchParams.get("status") || undefined,
        start: url.searchParams.get("start") || undefined,
        end: url.searchParams.get("end") || undefined,
        limit: 500
      });
      return ok(await repository.listEvents({
        tenantId: filters.tenantId,
        channel: filters.channel,
        status: filters.status,
        scheduledFrom: filters.start ? `${filters.start}T00:00:00.000Z` : undefined,
        scheduledTo: filters.end ? `${filters.end}T23:59:59.999Z` : undefined,
        limit: filters.limit
      }), requestId);
    }
    if (resource === "settings" && id === "reminders" && !action) {
      return ok(await repository.getPause(), requestId);
    }
    if (resource === "settings" && id === "test-contacts" && !action) {
      return ok(await repository.getTestContacts(), requestId);
    }
    if (resource === "viewing-schedule" && !id) {
      return ok(await getViewingSchedule(), requestId);
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
    rejectDisabledAdminAutomation(resource);
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
      await assertRecentAal2(prepared.admin);
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
      await assertRecentAal2(prepared.admin);
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
    if (resource === "tenants" && !id) {
      const tenant = await repository.createTenant(
        tenantCreateInputSchema.parse(body),
        actorId
      );
      await enqueueTenantUploadNotification(tenant)
        .then(() => deliverOwnerNotifications({ limit: 1 }))
        .catch(() => undefined);
      const reminderCatchUp = await attemptImmediateReminderCatchUp(tenant.id);
      return ok({ ...tenant, reminderCatchUp }, requestId, 201);
    }
    if (resource === "tenants" && id && action === "archive") {
      const payload = body as { expectedVersion?: unknown };
      return ok(await repository.archiveTenant(id, payload.expectedVersion, actorId), requestId);
    }
    if (resource === "tenants" && id && action === "schedule") {
      const payload = body as { schedule?: unknown; expectedVersion?: unknown };
      return ok(await repository.saveSchedule(id, payload.schedule, payload.expectedVersion, actorId), requestId);
    }
    if (resource === "clients" && id && action === "link") {
      return ok(
        await repository.linkClientToTenant(clientUserIdSchema.parse(id), body, actorId),
        requestId
      );
    }
    if (resource === "clients" && id && action === "unlink") {
      return ok(
        await repository.unlinkClientFromTenant(clientUserIdSchema.parse(id), actorId),
        requestId
      );
    }
    if (resource === "schedules" && id === "next-run") {
      const input = schedulePreviewSchema.parse(body);
      const settings = await repository.getPause();
      const occurrence = previewReminderOccurrence({
        rentDueDay: input.rentDueDay,
        moveInDate: input.moveInDate,
        leadDays: settings.leadDays,
        localTime: settings.localTime,
        timezone: settings.timezone,
        afterInstant: new Date().toISOString()
      });
      return ok({
        ...occurrence,
        leadDays: settings.leadDays,
        localTime: settings.localTime,
        emailTemplateId: settings.emailTemplateId,
        timezone: settings.timezone
      }, requestId);
    }
    if (resource === "templates" && !id) return ok(await repository.createTemplate(body, actorId), requestId, 201);
    if (resource === "notifications" && id === "preview") {
      return ok(await repository.previewNotification(body), requestId);
    }
    if (resource === "notifications" && id === "test-preview") {
      const payload = testNotificationSchema.parse(body);
      const [{ tenant }, templates, contacts, settings] = await Promise.all([
        repository.getTenant(payload.tenantId),
        repository.listTemplates(),
        repository.getTestContacts(),
        repository.getPause()
      ]);
      const channel = payload.channel;
      const template = templates.find((item) => item.id === payload.templateId && item.channel === channel && item.isActive);
      if (!template) throw new ApiError(400, "TEMPLATE_CHANNEL_MISMATCH", "Choose an active template for the selected channel.");
      const destination = channel === "email" ? contacts.email : contacts.phoneE164;
      if (!destination) throw new ApiError(409, "TEST_DESTINATION_MISSING", `Save an administrator-owned test ${channel} destination first.`);
      const leadDays = payload.leadDays ?? settings.leadDays;
      const localTime = payload.localTime ?? settings.localTime;
      const timezone = payload.timezone ?? settings.timezone;
      const occurrence = previewReminderOccurrence({
        rentDueDay: tenant.rentDueDay,
        moveInDate: tenant.moveInDate,
        leadDays,
        localTime,
        timezone,
        afterInstant: new Date().toISOString()
      });
      const context: TemplateContext = {
        tenant_name: tenant.fullName,
        property: tenant.propertyLabel,
        unit: tenant.unitLabel ?? "",
        due_date: formatRentDueDate(occurrence.dueDate),
        business_name: settings.businessName,
        business_phone: "604-872-6896",
        business_email: "info@silverkey.ca"
      };
      const subject = template.subjectTemplate ? renderTemplate(template.subjectTemplate, context) : null;
      const renderedBody = renderTemplate(template.bodyTemplate, context);
      const destinationMasked = channel === "email"
        ? `${destination.slice(0, 1)}***@${destination.split("@")[1]}`
        : `${destination.slice(0, 3)}***${destination.slice(-2)}`;
      return ok({
        requestId: payload.requestId,
        previewToken: createTestSendPreviewToken({
          actorId,
          tenantId: tenant.id,
          channel,
          templateId: template.id,
          templateVersion: template.updatedAt,
          requestId: payload.requestId,
          dueDate: occurrence.dueDate,
          leadDays,
          localTime,
          timezone,
          renderedSubject: subject,
          renderedBody,
          destination
        }),
        tenantId: tenant.id,
        channel,
        templateId: template.id,
        subject,
        body: renderedBody,
        dueDate: occurrence.dueDate,
        smsSegments: channel === "sms" ? estimateSmsSegments(renderedBody) : 0,
        destinationMasked,
        providerMode: channel === "email"
          ? (process.env.EMAIL_PROVIDER_MODE ?? "disabled")
          : (process.env.SMS_PROVIDER_MODE ?? "disabled")
      }, requestId);
    }
    if (resource === "notifications" && id === "test") {
      await assertRecentAuthentication(prepared.admin);
      await assertActionRateLimit(actorId, "notification-test", 5, 10 * 60);
      const input = testNotificationConfirmationSchema.parse(body);
      const preview = verifyTestSendPreviewToken(input.previewToken, {
        actorId,
        tenantId: input.tenantId,
        channel: input.channel,
        templateId: input.templateId,
        requestId: input.requestId
      });
      return ok(await repository.createTestEvent({
        tenantId: input.tenantId,
        channel: input.channel,
        templateId: input.templateId,
        requestId: input.requestId,
        dueDate: preview.dueDate,
        leadDays: preview.leadDays,
        localTime: preview.localTime,
        timezone: preview.timezone,
        renderedSubject: preview.renderedSubject,
        renderedBody: preview.renderedBody,
        destination: preview.destination
      }, actorId), requestId, 201);
    }
    if (resource === "notifications" && id === "batches" && !action) {
      return ok(await repository.createBatch(body, actorId), requestId, 201);
    }
    if (resource === "notifications" && id === "batches" && action && nested === "confirm") {
      await assertRecentAuthentication(prepared.admin);
      await assertActionRateLimit(actorId, "notification-batch-confirm", 3, 10 * 60);
      return ok(await repository.confirmBatch(action, body, actorId), requestId);
    }
    if (resource === "notifications" && id === "events" && action && nested === "retry") {
      await assertRecentAuthentication(prepared.admin);
      return ok(await repository.retryEvent(action, actorId), requestId, 201);
    }
    if (resource === "automation" && id === "service-accounts" && !action) {
      await assertRecentAal2(prepared.admin);
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
      await assertRecentAal2(prepared.admin);
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
      await assertRecentAal2(prepared.admin);
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
    rejectDisabledAdminAutomation(resource);
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
      await assertRecentAuthentication(prepared.admin);
      if ("businessName" in body) {
        const input = businessNameSettingsInputSchema.parse(body);
        return ok(
          await repository.saveBusinessName(input.businessName, input.expectedVersion, actorId),
          requestId
        );
      }
      if ("leadDays" in body || "localTime" in body || "emailTemplateId" in body) {
        const input = reminderSettingsInputSchema.parse(body);
        return ok(await repository.saveReminderSettings(input, actorId), requestId);
      }
      const input = pauseInputSchema.parse(body);
      return ok(await repository.setPause(input.paused, input.expectedVersion, actorId), requestId);
    }
    if (resource === "settings" && id === "test-contacts" && !action) {
      await assertRecentAuthentication(prepared.admin);
      return ok(await repository.setTestContacts(body, actorId), requestId);
    }
    if (resource === "viewing-schedule" && !id) {
      const input = body as unknown as ViewingScheduleInput & { expectedUpdatedAt?: string };
      await assertRecentAuthentication(prepared.admin);
      await assertActionRateLimit(actorId, "viewing-schedule-publish", 20, 60 * 60);
      if (typeof input.expectedUpdatedAt !== "string") {
        throw new ApiError(400, "VIEWING_SCHEDULE_VERSION_REQUIRED", "Reload the viewing schedule and try again.");
      }
      return ok(await saveViewingSchedule(
        input,
        input.expectedUpdatedAt
      ), requestId);
    }
    if (resource === "automation" && id === "service-accounts" && action) {
      await assertRecentAal2(prepared.admin);
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
