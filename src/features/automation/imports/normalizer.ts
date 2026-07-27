import { z } from "zod";
import type { ContactStatus, NotificationTemplate } from "@/lib/contracts";
import type { NormalizedTenantImportRow } from "@/features/automation/contracts";
import type { TenantImportHeader } from "@/features/automation/imports/header-map";
import { normalizeEmail, normalizePhoneE164 } from "@/features/tenants/contact-utils";

const emailStatuses: ContactStatus[] = [
  "unconfirmed", "allowed", "opted_out", "invalid", "bounced", "complained", "suppressed"
];
const smsStatuses = ["unconfirmed", "allowed", "opted_out", "invalid", "suppressed"] as const;

function text(value: string | undefined, collapse = true) {
  const normalized = (value ?? "").normalize("NFC").trim();
  return collapse ? normalized.replace(/\s+/g, " ") : normalized;
}

function nullable(value: string | undefined, collapse = true) {
  const result = text(value, collapse);
  return result || null;
}

function channels(value: string | undefined) {
  return [...new Set(text(value).toLowerCase().split(/[,;]/).map((item) => item.trim()).filter(Boolean))];
}

function permissionStatus(value: string | undefined, allowed: readonly string[]) {
  const normalized = text(value).toLowerCase() || "unconfirmed";
  return allowed.includes(normalized) ? normalized : null;
}

function templateId(value: string | undefined, channel: "email" | "sms", templates: NotificationTemplate[]) {
  const normalized = text(value);
  if (!normalized) return null;
  const matches = templates.filter(
    (template) =>
      template.channel === channel &&
      template.isActive &&
      (template.id === normalized || template.name.toLowerCase() === normalized.toLowerCase())
  );
  return matches.length === 1 ? matches[0].id : null;
}

export function normalizeTenantImportRow(
  row: Partial<Record<TenantImportHeader, string>>,
  templates: NotificationTemplate[] = []
): { value: NormalizedTenantImportRow | null; errorCodes: string[]; warnings: string[] } {
  const errorCodes: string[] = [];
  const warnings: string[] = [];
  const fullName = text(row.full_name);
  const propertyLabel = text(row.property);
  if (!fullName || fullName.length > 120) errorCodes.push("FULL_NAME_INVALID");
  if (!propertyLabel || propertyLabel.length > 160) errorCodes.push("PROPERTY_INVALID");

  const email = nullable(row.email) ? normalizeEmail(row.email ?? "") : null;
  if (email && !z.email().safeParse(email).success) errorCodes.push("EMAIL_INVALID");
  const phoneE164 = nullable(row.phone) ? normalizePhoneE164(row.phone ?? "") : null;
  if (phoneE164 && !/^\+[1-9]\d{7,14}$/.test(phoneE164)) errorCodes.push("PHONE_INVALID");
  const preferredChannels = channels(row.preferred_channels);
  if (preferredChannels.some((item) => item !== "email" && item !== "sms")) {
    errorCodes.push("PREFERRED_CHANNEL_INVALID");
  }
  const emailStatus = permissionStatus(row.email_permission, emailStatuses);
  const smsStatus = permissionStatus(row.sms_permission, smsStatuses);
  if (!emailStatus) errorCodes.push("EMAIL_PERMISSION_INVALID");
  if (!smsStatus) errorCodes.push("SMS_PERMISSION_INVALID");

  const emailSource = nullable(row.email_permission_source);
  const emailRecordedAt = nullable(row.email_permission_recorded_at);
  const emailEvidence = nullable(row.email_evidence_reference);
  const smsSource = nullable(row.sms_permission_source);
  const smsRecordedAt = nullable(row.sms_permission_recorded_at);
  const smsEvidence = nullable(row.sms_evidence_reference);
  if (emailStatus === "allowed" && (!emailSource || !emailRecordedAt || !emailEvidence)) {
    errorCodes.push("EMAIL_PERMISSION_EVIDENCE_REQUIRED");
  }
  if (smsStatus === "allowed" && (!smsSource || !smsRecordedAt || !smsEvidence)) {
    errorCodes.push("SMS_PERMISSION_EVIDENCE_REQUIRED");
  }
  if (emailRecordedAt && !z.iso.datetime().safeParse(emailRecordedAt).success) {
    errorCodes.push("EMAIL_PERMISSION_TIMESTAMP_INVALID");
  }
  if (smsRecordedAt && !z.iso.datetime().safeParse(smsRecordedAt).success) {
    errorCodes.push("SMS_PERMISSION_TIMESTAMP_INVALID");
  }

  const timezone = nullable(row.timezone) ?? "America/Vancouver";
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format();
  } catch {
    errorCodes.push("TIMEZONE_INVALID");
  }
  const reminderChannels = channels(row.reminder_channels);
  const hasSchedule = [
    row.rent_due_day,
    row.reminder_day,
    row.reminder_time,
    row.reminder_channels,
    row.email_template,
    row.sms_template
  ].some((item) => Boolean(text(item)));
  let schedule: NormalizedTenantImportRow["schedule"] = null;
  if (hasSchedule) {
    const rentDueDay = Number(row.rent_due_day);
    const dayOfMonth = Number(row.reminder_day);
    const localTime = text(row.reminder_time);
    if (!Number.isInteger(rentDueDay) || rentDueDay < 1 || rentDueDay > 31) errorCodes.push("RENT_DUE_DAY_INVALID");
    if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) errorCodes.push("REMINDER_DAY_INVALID");
    if (!/^\d{2}:\d{2}$/.test(localTime)) errorCodes.push("REMINDER_TIME_INVALID");
    if (
      reminderChannels.length === 0 ||
      reminderChannels.some((item) => item !== "email" && item !== "sms")
    ) errorCodes.push("REMINDER_CHANNEL_INVALID");
    const emailTemplateId = reminderChannels.includes("email")
      ? templateId(row.email_template, "email", templates)
      : null;
    const smsTemplateId = reminderChannels.includes("sms")
      ? templateId(row.sms_template, "sms", templates)
      : null;
    if (reminderChannels.includes("email") && !emailTemplateId) errorCodes.push("EMAIL_TEMPLATE_INVALID");
    if (reminderChannels.includes("sms") && !smsTemplateId) errorCodes.push("SMS_TEMPLATE_INVALID");
    schedule = {
      rentDueDay,
      dayOfMonth,
      localTime,
      timezone,
      channels: reminderChannels.filter((item): item is "email" | "sms" => item === "email" || item === "sms"),
      emailTemplateId,
      smsTemplateId,
      isEnabled: false
    };
  }

  const isActiveText = text(row.is_active).toLowerCase();
  const isActive = !isActiveText || ["true", "yes", "1"].includes(isActiveText);
  if (isActiveText && !["true", "yes", "1", "false", "no", "0"].includes(isActiveText)) {
    errorCodes.push("IS_ACTIVE_INVALID");
  }
  const internalNotes = nullable(row.internal_notes, false);
  if (internalNotes && (internalNotes.length > 2_000 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(internalNotes))) {
    errorCodes.push("INTERNAL_NOTES_INVALID");
  }
  if (Object.values(row).some((value) => /ignore previous|reveal.+token|publish all|send.+another url/i.test(value ?? ""))) {
    warnings.push("PROMPT_INJECTION_TEXT_IGNORED");
  }

  if (errorCodes.length > 0) return { value: null, errorCodes, warnings };
  return {
    value: {
      externalReference: nullable(row.external_reference),
      fullName,
      propertyLabel,
      unitLabel: nullable(row.unit),
      email,
      phoneE164,
      preferredChannels: preferredChannels.filter((item): item is "email" | "sms" => item === "email" || item === "sms"),
      emailContactStatus: emailStatus as ContactStatus,
      smsContactStatus: smsStatus as NormalizedTenantImportRow["smsContactStatus"],
      emailPermissionSource: emailSource,
      emailPermissionRecordedAt: emailRecordedAt,
      emailEvidenceReference: emailEvidence,
      smsPermissionSource: smsSource,
      smsPermissionRecordedAt: smsRecordedAt,
      smsEvidenceReference: smsEvidence,
      timezone,
      internalNotes,
      isActive,
      schedule
    },
    errorCodes,
    warnings
  };
}

