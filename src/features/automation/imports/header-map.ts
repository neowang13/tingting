import { ApiError } from "@/lib/api";

export const canonicalTenantImportHeaders = [
  "external_reference",
  "full_name",
  "property",
  "unit",
  "email",
  "phone",
  "preferred_channels",
  "email_permission",
  "email_permission_source",
  "email_permission_recorded_at",
  "email_evidence_reference",
  "sms_permission",
  "sms_permission_source",
  "sms_permission_recorded_at",
  "sms_evidence_reference",
  "timezone",
  "internal_notes",
  "is_active",
  "rent_due_day",
  "reminder_day",
  "reminder_time",
  "reminder_channels",
  "email_template",
  "sms_template"
] as const;

export type TenantImportHeader = (typeof canonicalTenantImportHeaders)[number];

const aliases: Record<string, TenantImportHeader> = {
  name: "full_name",
  tenant_name: "full_name",
  property_name: "property",
  suite: "unit",
  mobile: "phone",
  phone_number: "phone",
  email_consent: "email_permission",
  sms_consent: "sms_permission",
  reminder_day_of_month: "reminder_day",
  reminder_local_time: "reminder_time"
};

export const TENANT_IMPORT_HEADER_VERSION = 1;

export function normalizeHeader(value: string) {
  return value.normalize("NFC").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export function mapTenantImportHeaders(values: string[]) {
  if (values.length === 0 || values.length > 40) {
    throw new ApiError(422, "IMPORT_COLUMN_LIMIT", "Imports must contain between 1 and 40 columns.");
  }
  const mapped: Array<TenantImportHeader | null> = [];
  const seen = new Set<TenantImportHeader>();
  const warnings: string[] = [];
  for (const raw of values) {
    const normalized = normalizeHeader(raw);
    const canonical = (canonicalTenantImportHeaders as readonly string[]).includes(normalized)
      ? normalized as TenantImportHeader
      : aliases[normalized] ?? null;
    if (!canonical) {
      mapped.push(null);
      warnings.push(`UNKNOWN_COLUMN:${normalized || "blank"}`);
      continue;
    }
    if (seen.has(canonical)) {
      throw new ApiError(
        422,
        "IMPORT_DUPLICATE_HEADER",
        "Two source columns map to the same canonical tenant field.",
        { header: canonical }
      );
    }
    seen.add(canonical);
    mapped.push(canonical);
  }
  for (const required of ["full_name", "property"] as TenantImportHeader[]) {
    if (!seen.has(required)) {
      throw new ApiError(422, "IMPORT_REQUIRED_HEADER", `The ${required} column is required.`);
    }
  }
  return { mapped, warnings, version: TENANT_IMPORT_HEADER_VERSION };
}

