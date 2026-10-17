import type { McpScope } from "./config";
export const permissionLabels: Record<McpScope, string> = {
  "rentals:read": "View property information and drafts", "rentals:write": "Create and edit properties, upload photos, publish or remove listings",
  "applications:read": "View rental applications and personal form information", "applications:write": "Change application status, including approval and decline",
  "showings:read": "View viewing requests and visitor contacts", "showings:write": "Manage viewing requests and calendar drafts"
};
