import { z } from "zod";
import { validateTemplateVariables } from "@/features/notifications/template-renderer";
import {
  normalizeEmail,
  normalizePhoneE164
} from "@/features/tenants/contact-utils";

const isoTimestampSchema = z.iso.datetime({ offset: true });

function isValidTimezone(value: string) {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export const expectedVersionSchema = z.object({
  expectedVersion: isoTimestampSchema
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

export const propertyTypeSchema = z.enum([
  "apartment",
  "condo",
  "townhome",
  "house",
  "basement_suite",
  "room",
  "other"
]);
export const availabilityStatusSchema = z.enum(["available_now", "available_on", "contact"]);
export const furnishedStatusSchema = z.enum(["unfurnished", "furnished", "partly_furnished"]);
export const leaseTypeSchema = z.enum(["fixed_term", "month_to_month", "flexible"]);
export const smokingPolicySchema = z.enum(["not_allowed", "outdoor_only", "allowed", "contact"]);
export const petStatusSchema = z.enum(["not_allowed", "considered", "allowed"]);

const nullableTrimmed = (maximum: number) => z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? null : value,
  z.string().trim().max(maximum).nullable()
);

const rentalImageInputSchema = z.object({
  mediaAssetId: z.uuid(),
  sortOrder: z.number().int().nonnegative(),
  isCover: z.boolean()
}).strict();

export const rentalListingV2InputSchema = z.object({
  slug: z.string().trim().min(2).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().trim().min(1).max(120),
  property: z.object({
    id: z.uuid().nullable(),
    expectedVersion: isoTimestampSchema.nullable(),
    propertyType: propertyTypeSchema,
    buildingName: nullableTrimmed(120),
    unitNumber: nullableTrimmed(40),
    streetAddress: z.string().trim().min(1).max(160),
    neighbourhood: nullableTrimmed(100),
    city: z.string().trim().min(1).max(100),
    provinceCode: z.preprocess(
      (value) => typeof value === "string" && value.trim() ? value.trim().toUpperCase() : null,
      z.string().length(2).nullable()
    ),
    postalCode: z.preprocess(
      (value) => {
        if (typeof value !== "string" || !value.trim()) return null;
        const compact = value.toUpperCase().replace(/\s+/g, "");
        return compact.length === 6 ? `${compact.slice(0, 3)} ${compact.slice(3)}` : value.toUpperCase().trim();
      },
      z.string().regex(/^[A-Z]\d[A-Z] \d[A-Z]\d$/).nullable()
    ),
    countryCode: z.literal("CA")
  }).strict(),
  pricing: z.object({
    monthlyRentCents: z.number().int().positive(),
    currencyCode: z.literal("CAD")
  }).strict(),
  layout: z.object({
    bedrooms: z.number().min(0).max(20),
    bathrooms: z.number().min(0).max(20),
    denCount: z.number().int().min(0).max(20).default(0),
    squareFeet: z.number().int().positive().nullable(),
    furnishedStatus: furnishedStatusSchema.nullable()
  }).strict(),
  availability: z.object({
    status: availabilityStatusSchema.nullable(),
    availableOn: z.iso.date().nullable(),
    leaseType: leaseTypeSchema.nullable(),
    minimumLeaseMonths: z.number().int().positive().max(120).nullable()
  }).strict(),
  parking: z.object({
    available: z.boolean(),
    type: z.enum(["underground", "garage", "surface", "street", "carport", "other"]).nullable(),
    stalls: z.number().int().nonnegative().nullable(),
    included: z.boolean().nullable(),
    visitorAvailable: z.boolean(),
    notes: nullableTrimmed(500)
  }).strict(),
  storage: z.object({
    available: z.boolean(),
    lockers: z.number().int().nonnegative().nullable(),
    included: z.boolean().nullable(),
    notes: nullableTrimmed(500)
  }).strict(),
  pets: z.object({
    status: petStatusSchema.nullable(),
    catsAllowed: z.boolean(),
    dogsAllowed: z.boolean(),
    maxCount: z.number().int().positive().max(20).nullable(),
    sizeLimitLbs: z.number().int().positive().max(500).nullable(),
    notes: nullableTrimmed(500)
  }).strict(),
  smokingPolicy: smokingPolicySchema.nullable(),
  applicationRequirements: z.object({
    creditCheckRequired: z.boolean(),
    referencesRequired: z.boolean()
  }).strict(),
  amenityCodes: z.array(z.string().regex(/^[a-z0-9_]+$/)).max(100),
  includedUtilityCodes: z.array(z.string().regex(/^[a-z0-9_]+$/)).max(30),
  fees: z.array(z.object({
    id: z.uuid().optional(),
    feeType: z.enum(["security_deposit", "pet_deposit", "parking", "storage", "move_in", "other"]),
    label: nullableTrimmed(120),
    amountCents: z.number().int().positive(),
    frequency: z.enum(["one_time", "monthly"]),
    refundable: z.boolean(),
    required: z.boolean(),
    notes: nullableTrimmed(500),
    sortOrder: z.number().int().nonnegative()
  }).strict()).max(30),
  contact: z.object({
    mode: z.enum(["site_default", "custom"]),
    name: nullableTrimmed(120),
    email: z.preprocess(
      (value) => typeof value === "string" && value.trim() ? normalizeEmail(value) : null,
      z.email().nullable()
    ),
    phone: nullableTrimmed(30)
  }).strict(),
  utilitiesNotes: nullableTrimmed(500),
  amenityNotes: nullableTrimmed(500),
  description: z.string().trim().min(1).max(5000),
  images: z.array(rentalImageInputSchema).max(20)
}).strict().superRefine((value, ctx) => {
  if (new Set(value.images.map((image) => image.mediaAssetId)).size !== value.images.length) {
    ctx.addIssue({ code: "custom", path: ["images"], message: "Each rental image may be selected once." });
  }
  if (value.images.filter((image) => image.isCover).length > 1) {
    ctx.addIssue({ code: "custom", path: ["images"], message: "Choose only one cover image." });
  }
  if (value.availability.status === "available_on" && !value.availability.availableOn) {
    ctx.addIssue({ code: "custom", path: ["availability", "availableOn"], message: "Choose the available date." });
  }
  if (value.availability.status !== "available_on" && value.availability.availableOn) {
    ctx.addIssue({ code: "custom", path: ["availability", "availableOn"], message: "Available date must be empty for this selection." });
  }
  if (value.availability.leaseType === "fixed_term" && !value.availability.minimumLeaseMonths) {
    ctx.addIssue({ code: "custom", path: ["availability", "minimumLeaseMonths"], message: "Enter the minimum fixed lease term." });
  }
  if (!value.parking.available && (value.parking.type || value.parking.stalls || value.parking.included)) {
    ctx.addIssue({ code: "custom", path: ["parking"], message: "Clear parking details when parking is unavailable." });
  }
  if (value.parking.available && (!value.parking.type || value.parking.stalls === null || value.parking.included === null)) {
    ctx.addIssue({ code: "custom", path: ["parking"], message: "Complete the parking details." });
  }
  if (!value.storage.available && (value.storage.lockers || value.storage.included)) {
    ctx.addIssue({ code: "custom", path: ["storage"], message: "Clear storage details when storage is unavailable." });
  }
  if (value.storage.available && (value.storage.lockers === null || value.storage.included === null)) {
    ctx.addIssue({ code: "custom", path: ["storage"], message: "Complete the storage details." });
  }
  if (value.pets.status === "not_allowed" && (
    value.pets.catsAllowed || value.pets.dogsAllowed || value.pets.maxCount || value.pets.sizeLimitLbs
  )) {
    ctx.addIssue({ code: "custom", path: ["pets"], message: "Clear pet details when pets are not allowed." });
  }
  if (value.contact.mode === "custom" && (!value.contact.name || (!value.contact.email && !value.contact.phone))) {
    ctx.addIssue({ code: "custom", path: ["contact"], message: "Custom contact requires a name and an email or phone." });
  }
  value.fees.forEach((fee, index) => {
    if (fee.feeType === "other" && !fee.label) {
      ctx.addIssue({ code: "custom", path: ["fees", index, "label"], message: "Name the other fee." });
    }
  });
});

export function publishRequirementPaths(input: z.infer<typeof rentalListingV2InputSchema>): string[] {
  const missing: string[] = [];
  if (!input.property.provinceCode) missing.push("property.provinceCode");
  if (!input.property.postalCode) missing.push("property.postalCode");
  if (!input.availability.status) missing.push("availability.status");
  if (!input.layout.furnishedStatus) missing.push("layout.furnishedStatus");
  if (!input.availability.leaseType) missing.push("availability.leaseType");
  if (!input.smokingPolicy) missing.push("smokingPolicy");
  if (!input.pets.status) missing.push("pets.status");
  if (input.images.length < 1) missing.push("images");
  if (input.images.filter((image) => image.isCover).length !== 1) missing.push("images.cover");
  return missing;
}

const channelSchema = z.enum(["email", "sms"]);
const notificationStatusSchema = z.enum([
  "scheduled",
  "processing",
  "queued",
  "sent",
  "delivered",
  "failed",
  "undelivered",
  "skipped",
  "unknown",
  "expired",
  "cancelled"
]);

export const tenantListFilterSchema = z.object({
  query: z.string().trim().max(120).optional(),
  lifecycle: z.enum(["active", "inactive", "archived"]).optional(),
  contact: z.enum(["email_allowed", "email_blocked", "sms_allowed", "sms_blocked"]).optional(),
  schedule: z.enum(["enabled", "disabled", "missing"]).optional(),
  rentStatus: z.enum(["due", "collected"]).optional(),
  leaseType: z.enum(["month_to_month", "fixed_term", "needs_details"]).optional(),
  limit: z.number().int().min(1).max(500).optional()
}).strict();

export const notificationEventFilterSchema = z.object({
  tenantId: z.uuid().optional(),
  channel: channelSchema.optional(),
  status: notificationStatusSchema.optional(),
  start: z.iso.date().optional(),
  end: z.iso.date().optional(),
  limit: z.number().int().min(1).max(500).optional()
}).strict().superRefine((value, context) => {
  if (value.start && value.end && value.start > value.end) {
    context.addIssue({
      code: "custom",
      path: ["end"],
      message: "The end date must be on or after the start date."
    });
  }
});

export const tenantInputSchema = z
  .object({
    fullName: z.string().trim().min(1).max(120),
    propertyLabel: z.string().trim().min(1).max(160),
    unitLabel: z.string().trim().max(60).nullable().default(null),
    moveInDate: z.iso.date().nullable().optional(),
    leaseType: z.enum(["month_to_month", "fixed_term"]).nullable().default(null),
    leaseEndDate: z.iso.date().nullable().default(null),
    rentDueDay: z.number().int().min(1).max(31).default(1),
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
    contactPermissionUpdatedAt: isoTimestampSchema.nullable().default(null),
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
    if (value.leaseType && !value.moveInDate) {
      ctx.addIssue({ code: "custom", path: ["moveInDate"], message: "Lease start date is required." });
    }
    if (value.leaseType === "fixed_term" && !value.leaseEndDate) {
      ctx.addIssue({ code: "custom", path: ["leaseEndDate"], message: "Lease end date is required." });
    }
    if (
      value.leaseType === "fixed_term"
      && value.moveInDate
      && value.leaseEndDate
      && value.leaseEndDate <= value.moveInDate
    ) {
      ctx.addIssue({ code: "custom", path: ["leaseEndDate"], message: "Lease end date must be after the start date." });
    }
    if (value.leaseType === "month_to_month" && value.leaseEndDate) {
      ctx.addIssue({ code: "custom", path: ["leaseEndDate"], message: "Month-to-month leases cannot have an end date." });
    }
    if (!value.leaseType && value.leaseEndDate) {
      ctx.addIssue({ code: "custom", path: ["leaseEndDate"], message: "Choose a lease type before entering an end date." });
    }
  });

export const tenantCreateInputSchema = tenantInputSchema.superRefine((value, ctx) => {
  if (!value.leaseType) {
    ctx.addIssue({
      code: "custom",
      path: ["leaseType"],
      message: "Lease type is required for a new tenant."
    });
  }
});

export const clientUserIdSchema = z.uuid();

export const clientTenantLinkInputSchema = z.object({
  tenantId: z.uuid()
}).strict();

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

export const schedulePreviewSchema = z.object({
  rentDueDay: z.number().int().min(1).max(31),
  moveInDate: z.iso.date().nullable().optional()
}).strict();

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
    expectedVersion: isoTimestampSchema
  })
  .strict();

export const businessNameSettingsInputSchema = z
  .object({
    businessName: z.string().trim().min(1, "Enter a business name.").max(100),
    expectedVersion: isoTimestampSchema
  })
  .strict();

export const reminderSettingsInputSchema = z
  .object({
    paused: z.boolean(),
    leadDays: z.number().int().min(0).max(31),
    localTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    timezone: z
      .string()
      .refine(isValidTimezone, "Enter a valid IANA timezone.")
      .refine((value) => value === "America/Vancouver", "Timezone must be America/Vancouver."),
    emailTemplateId: z.uuid(),
    expectedVersion: isoTimestampSchema
  })
  .strict();

export const testContactsInputSchema = z.object({
  email: z.email().nullable(),
  phoneE164: z.string().regex(/^\+[1-9]\d{7,14}$/).nullable(),
  expectedVersion: isoTimestampSchema
}).strict();

export const testNotificationSchema = z.object({
  tenantId: z.uuid(),
  channel: channelSchema,
  templateId: z.uuid(),
  requestId: z.uuid(),
  leadDays: z.number().int().min(0).max(31).optional(),
  localTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).optional(),
  timezone: z
    .string()
    .refine(isValidTimezone, "Enter a valid IANA timezone.")
    .optional(),
  dueDate: z.iso.date().optional(),
  renderedSubject: z.string().max(500).nullable().optional(),
  renderedBody: z.string().max(5000).optional(),
  destination: z.string().max(320).optional()
}).strict();

export const testNotificationConfirmationSchema = z.object({
  tenantId: z.uuid(),
  channel: channelSchema,
  templateId: z.uuid(),
  requestId: z.uuid(),
  previewToken: z.string().min(40).max(12000)
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

export const showingRequestInputSchema = z.preprocess(
  (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const normalized = { ...(value as Record<string, unknown>) };
    // Tolerate already-open clients from before the checkbox removal, but do
    // not treat or persist any removed booking field as current information.
    delete normalized.desiredMoveInDate;
    delete normalized.hasPets;
    delete normalized.needsParking;
    delete normalized.consent;
    delete normalized.representationDisclosureAcknowledged;
    return normalized;
  },
  z.object({
    name: z.string().trim().min(1).max(120),
    phone: z.string().trim().min(7).max(30),
    email: z.email().max(254),
    propertySlug: z.string().trim().min(2).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    requestedLocalDate: z.iso.date(),
    requestedLocalTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    timezone: z.literal("America/Vancouver"),
    notes: z.string().trim().max(1000).optional().default(""),
    website: z.string().trim().max(200).optional().default("")
  }).strict().superRefine((value, ctx) => {
    if (value.website) return;
    const digits = value.phone.replace(/\D/g, "");
    if (digits.length < 7 || digits.length > 15) {
      ctx.addIssue({
        code: "custom",
        path: ["phone"],
        message: "Enter a valid phone number."
      });
    }
  })
);

export const rentalSearchQuerySchema = z
  .object({
    location: z.string().trim().max(120).optional(),
    propertyType: propertyTypeSchema.optional(),
    priceRange: z.enum(["under-2500", "2500-3000", "over-3000"]).optional(),
    beds: z.coerce.number().int().min(0).max(20).optional(),
    baths: z.coerce.number().int().min(0).max(20).optional()
  })
  .strict();
