import type { AutomationConfirmationAction, AutomationScope } from "@/features/automation/contracts";
import { ApiError } from "@/lib/api";

export type AutomationRouteName =
  | "health"
  | "rentals.list"
  | "rentals.get"
  | "rentals.create"
  | "rentals.update"
  | "rentals.statusPreview"
  | "media.upload"
  | "tenants.list"
  | "tenants.get"
  | "tenants.create"
  | "tenants.update"
  | "tenants.permissionPreview"
  | "imports.create"
  | "imports.get"
  | "imports.rows"
  | "imports.commitPreview"
  | "schedules.get"
  | "schedules.save"
  | "schedules.statusPreview"
  | "confirmations.execute"
  | "jobs.get";

export const routeScopes: Record<AutomationRouteName, AutomationScope | null> = {
  health: null,
  "rentals.list": "rentals:read",
  "rentals.get": "rentals:read",
  "rentals.create": "rentals:write",
  "rentals.update": "rentals:write",
  "rentals.statusPreview": "rentals:publish",
  "media.upload": "media:write",
  "tenants.list": "tenants:read",
  "tenants.get": "tenants:read",
  "tenants.create": "tenants:write",
  "tenants.update": "tenants:write",
  "tenants.permissionPreview": "permissions:grant",
  "imports.create": "tenants:import",
  "imports.get": "tenants:import",
  "imports.rows": "tenants:import",
  "imports.commitPreview": "tenants:import",
  "schedules.get": "schedules:read",
  "schedules.save": "schedules:write",
  "schedules.statusPreview": "schedules:enable",
  "confirmations.execute": null,
  "jobs.get": "jobs:read"
};

export const confirmationActionScopes: Record<AutomationConfirmationAction, AutomationScope> = {
  "rental.publish": "rentals:publish",
  "rental.unpublish": "rentals:publish",
  "rental.archive": "rentals:publish",
  "tenant_import.commit": "tenants:import",
  "tenant.permission.grant": "permissions:grant",
  "tenant.archive": "tenants:write",
  "schedule.enable": "schedules:enable",
  "schedule.disable": "schedules:enable"
};

export function assertAutomationScope(scopes: AutomationScope[], required: AutomationScope | null) {
  if (required && !scopes.includes(required)) {
    throw new ApiError(403, "AUTOMATION_SCOPE_REQUIRED", `The ${required} scope is required.`);
  }
}

