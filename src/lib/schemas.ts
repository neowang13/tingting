import { z } from "zod";
import { validateTemplateVariables } from "@/features/notifications/template-renderer";
import {
  normalizeEmail,
  normalizePhoneE164
} from "@/features/tenants/contact-utils";

function isValidTimezone(value: string) {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export const expectedVersionSchema = z.object({
  expectedVersion: z.iso.datetime()
});

export const rentalInputSchema = z
  .object({
    slug: z.string().trim().min(2).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    title: z.string().trim().min(1).max(120),
    addressLine: z.string().trim().min(1).max(160),
    neighbourhood: z.string().trim().max(100).nullable().default(null),
    city: z.string().trim().min(1).max(100),
    monthlyRentCents: z.number().int().positive(),
    bedrooms: z.number().min(0).max(20),
    bathrooms: z.number().min(0).max(20),
    squareFeet: z.number().int().positive().nullable().default(null),
    availableOn: z.iso.date().nullable().default(null),
    petPolicy: z.string().trim().max(240).nullable().default(null),
    description: z.string().trim().min(1).max(5000),
    sortOrder: z.number().int().default(0),
    coverImageUrl: z.url().nullable().default(null),
    images: z.array(z.object({
      mediaAssetId: z.uuid(),
      sortOrder: z.number().int().nonnegative(),
      isCover: z.boolean()
    }).strict()).max(20).default([])
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.images.map((image) => image.mediaAssetId)).size !== value.images.length) {
      ctx.addIssue({ code: "custom", path: ["images"], message: "Each rental image may be selected once." });
    }
    if (value.images.filter((image) => image.isCover).length > 1) {
      ctx.addIssue({ code: "custom", path: ["images"], message: "Choose only one cover image." });
    }
  });

const channelSchema = z.enum(["email", "sms"]);

export const tenantInputSchema = z
  .object({
    fullName: z.string().trim().min(1).max(120),
    propertyLabel: z.string().trim().min(1).max(160),
    unitLabel: z.string().trim().max(60).nullable().default(null),
    email: z.preprocess(
      (value) => typeof value === "string" && value.trim() ? normalizeEmail(value) : null,
      z.email().nullable()
    ).default(null),
    phoneE164: z.preprocess(
      (value) => typeof value === "string" && value.trim() ? normalizePhoneE164(value) : null,
      z.string().regex(/^\+[1-9]\d{7,14}$/).nullable()
    ).default(null),
    preferredChannels: z.array(channelSchema).max(2),
    emailContactStatus: z
      .enum(["unconfirmed", "allowed", "opted_out", "invalid", "bounced", "complained", "suppressed"])
      .default("unconfirmed"),
    smsContactStatus: z
      .enum(["unconfirmed", "allowed", "opted_out", "invalid", "suppressed"])
      .default("unconfirmed"),
    emailContactStatusReason: z.string().trim().max(500).nullable().default(null),
    smsContactStatusReason: z.string().trim().max(500).nullable().default(null),
    emailContactStatusSource: z.string().trim().max(120).nullable().default(null),
    smsContactStatusSource: z.string().trim().max(120).nullable().default(null),
    contactPermissionNote: z.string().trim().max(1000).nullable().default(null),
    contactPermissionUpdatedAt: z.iso.datetime().nullable().default(null),
    timezone: z.string().refine(isValidTimezone, "Enter a valid IANA timezone.").default("America/Vancouver"),
    internalNotes: z.string().max(2000).nullable().default(null),
    isActive: z.boolean().default(true)
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.preferredChannels.includes("email") && !value.email) {
      ctx.addIssue({ code: "custom", path: ["email"], message: "Email is required for the email channel." });
    }
    if (value.preferredChannels.includes("sms") && !value.phoneE164) {
      ctx.addIssue({ code: "custom", path: ["phoneE164"], message: "Phone is required for the SMS channel." });
    }
  });

export const scheduleInputSchema = z
  .object({
    rentDueDay: z.number().int().min(1).max(31),
    dayOfMonth: z.number().int().min(1).max(31),
    localTime: z.string().regex(/^\d{2}:\d{2}$/),
    timezone: z.string().refine(isValidTimezone, "Enter a valid IANA timezone.").default("America/Vancouver"),
    channels: z.array(channelSchema).min(1).max(2),
    emailTemplateId: z.uuid().nullable().default(null),
    smsTemplateId: z.uuid().nullable().default(null),
    isEnabled: z.boolean().default(false)
  })
  .strict();

export const templateInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    channel: channelSchema,
    subjectTemplate: z.string().trim().max(240).nullable().default(null),
    bodyTemplate: z.string().trim().min(1).max(3000),
    isActive: z.boolean().default(true)
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.channel === "email" && !value.subjectTemplate) {
      ctx.addIssue({ code: "custom", path: ["subjectTemplate"], message: "Email templates require a subject." });
    }
    if (value.channel === "sms" && value.subjectTemplate) {
      ctx.addIssue({ code: "custom", path: ["subjectTemplate"], message: "SMS templates cannot have a subject." });
    }
    try {
      validateTemplateVariables(value.subjectTemplate, value.bodyTemplate);
    } catch (error) {
      ctx.addIssue({
        code: "custom",
        path: ["bodyTemplate"],
        message: error instanceof Error ? error.message : "Template variables are invalid."
      });
    }
  });

export const notificationPreviewSchema = z
  .object({
    selectionMode: z.enum(["tenant_ids", "all_active"]),
    tenantIds: z.array(z.uuid()).default([]),
    channels: z.array(channelSchema).min(1).max(2),
    emailTemplateId: z.uuid().nullable().default(null),
    smsTemplateId: z.uuid().nullable().default(null),
    requestId: z.uuid()
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.channels.includes("email") && !value.emailTemplateId) {
      ctx.addIssue({ code: "custom", path: ["emailTemplateId"], message: "Select an email template." });
    }
    if (value.channels.includes("sms") && !value.smsTemplateId) {
      ctx.addIssue({ code: "custom", path: ["smsTemplateId"], message: "Select an SMS template." });
    }
    if (value.selectionMode === "tenant_ids" && value.tenantIds.length === 0) {
      ctx.addIssue({ code: "custom", path: ["tenantIds"], message: "Select at least one tenant." });
    }
  });

export const batchConfirmSchema = z
  .object({
    confirmationIdempotencyKey: z.string().trim().min(8).max(200),
    acknowledgedRecipientCount: z.number().int().nonnegative()
  })
  .strict();

export const pauseInputSchema = z
  .object({
    paused: z.boolean(),
    expectedVersion: z.iso.datetime()
  })
  .strict();

export const testContactsInputSchema = z.object({
  email: z.email().nullable(),
  phoneE164: z.string().regex(/^\+[1-9]\d{7,14}$/).nullable(),
  expectedVersion: z.iso.datetime()
}).strict();

export const testNotificationSchema = z.object({
  tenantId: z.uuid(),
  channel: channelSchema,
  templateId: z.uuid(),
  requestId: z.uuid()
}).strict();

export const contactInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    email: z.email().optional(),
    phone: z.string().trim().max(30).optional(),
    preferredContact: z.enum(["email", "phone", "sms"]),
    message: z.string().trim().min(1).max(3000),
    website: z.string().trim().max(200).optional().default("")
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.website) return;
    if (value.preferredContact === "email" && !value.email) {
      ctx.addIssue({
        code: "custom",
        path: ["email"],
        message: "Enter an email address when email is your preferred contact method."
      });
    }
    if (value.preferredContact !== "email" && !value.phone) {
      ctx.addIssue({
        code: "custom",
        path: ["phone"],
        message: "Enter a phone number for phone or SMS contact."
      });
    }
  });

export const rentalSearchQuerySchema = z
  .object({
    location: z.string().trim().max(120).optional(),
    propertyType: z.enum(["apartment", "townhome", "house"]).optional(),
    priceRange: z.enum(["under-2500", "2500-3000", "over-3000"]).optional(),
    beds: z.coerce.number().int().min(0).max(20).optional(),
    baths: z.coerce.number().int().min(0).max(20).optional()
  })
  .strict();
