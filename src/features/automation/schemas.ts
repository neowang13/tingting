import { z } from "zod";
import { rentalInputSchema, scheduleInputSchema, tenantInputSchema } from "@/lib/schemas";
import { automationScopes } from "@/features/automation/contracts";

export const requestIdSchema = z.uuid();
export const idempotencyKeySchema = z.uuid();
export const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const cursorSchema = z.string().max(500).optional();
export const limitSchema = z.coerce.number().int().min(1).max(100).default(50);
const resourceVersionSchema = z.iso.datetime({ offset: true });

export const automationRentalInputSchema = z
  .object({
    slug: rentalInputSchema.shape.slug,
    title: rentalInputSchema.shape.title,
    addressLine: rentalInputSchema.shape.addressLine,
    neighbourhood: rentalInputSchema.shape.neighbourhood,
    city: rentalInputSchema.shape.city,
    monthlyRentCents: rentalInputSchema.shape.monthlyRentCents,
    bedrooms: rentalInputSchema.shape.bedrooms,
    bathrooms: rentalInputSchema.shape.bathrooms,
    squareFeet: rentalInputSchema.shape.squareFeet,
    availableOn: rentalInputSchema.shape.availableOn,
    petPolicy: rentalInputSchema.shape.petPolicy,
    description: rentalInputSchema.shape.description,
    sortOrder: rentalInputSchema.shape.sortOrder,
    images: rentalInputSchema.shape.images,
    sourceSystem: z.string().trim().min(1).max(60).default("openclaw"),
    externalReference: z.string().trim().min(1).max(120).nullable().default(null)
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

export const automationTenantInputSchema = z
  .object({
    ...tenantInputSchema.shape,
    leaseStartDate: z.iso.date().nullable().optional(),
    sourceSystem: z.string().trim().min(1).max(60).nullable().default("openclaw"),
    externalReference: z.string().trim().min(1).max(120).nullable().default(null)
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.preferredChannels.includes("email") && !value.email) {
      ctx.addIssue({ code: "custom", path: ["email"], message: "Email is required for the email channel." });
    }
    if (value.preferredChannels.includes("sms") && !value.phoneE164) {
      ctx.addIssue({ code: "custom", path: ["phoneE164"], message: "Phone is required for the SMS channel." });
    }
    if (
      value.leaseStartDate
      && value.moveInDate
      && value.leaseStartDate !== value.moveInDate
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["leaseStartDate"],
        message: "leaseStartDate and legacy moveInDate must match when both are supplied."
      });
    }
  })
  .transform(({ leaseStartDate, ...value }) => ({
    ...value,
    moveInDate: leaseStartDate ?? value.moveInDate
  }));

export const tenantPdfOnboardingSchema = z
  .object({
    tenant: automationTenantInputSchema,
    ownerConfirmation: z.object({
      confirmedAt: z.iso.datetime({ offset: true }),
      documentDigest: digestSchema
    }).strict()
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.tenant.email) {
      ctx.addIssue({
        code: "custom",
        path: ["tenant", "email"],
        message: "PDF onboarding requires an email address."
      });
    }
  });

export const disabledScheduleInputSchema = scheduleInputSchema.extend({
  isEnabled: z.literal(false)
}).strict();

export const rentalUpdateSchema = z.object({
  rental: automationRentalInputSchema,
  expectedVersion: resourceVersionSchema
}).strict();

export const automationTenantPatchSchema = z
  .object({
    fullName: tenantInputSchema.shape.fullName.optional(),
    propertyLabel: tenantInputSchema.shape.propertyLabel.optional(),
    unitLabel: tenantInputSchema.shape.unitLabel.removeDefault().optional(),
    moveInDate: tenantInputSchema.shape.moveInDate.optional(),
    leaseStartDate: z.iso.date().nullable().optional(),
    leaseType: tenantInputSchema.shape.leaseType.removeDefault().optional(),
    leaseEndDate: tenantInputSchema.shape.leaseEndDate.removeDefault().optional(),
    rentDueDay: tenantInputSchema.shape.rentDueDay.removeDefault().optional(),
    email: tenantInputSchema.shape.email.removeDefault().optional(),
    phoneE164: tenantInputSchema.shape.phoneE164.removeDefault().optional(),
    preferredChannels: tenantInputSchema.shape.preferredChannels.optional(),
    timezone: tenantInputSchema.shape.timezone.removeDefault().optional(),
    internalNotes: tenantInputSchema.shape.internalNotes.removeDefault().optional(),
    isActive: tenantInputSchema.shape.isActive.removeDefault().optional()
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one tenant field must be supplied."
  })
  .transform(({ leaseStartDate, ...value }) => ({
    ...value,
    ...(leaseStartDate !== undefined ? { moveInDate: leaseStartDate } : {})
  }));

export const tenantPatchSchema = z.object({
  changes: automationTenantPatchSchema,
  expectedVersion: resourceVersionSchema
}).strict();

export const scheduleSaveSchema = z.object({
  schedule: disabledScheduleInputSchema,
  expectedVersion: resourceVersionSchema.nullable()
}).strict();

export const rentalStatusPreviewSchema = z.object({
  action: z.enum(["publish", "unpublish", "archive"]),
  expectedVersion: resourceVersionSchema
}).strict();

export const scheduleStatusPreviewSchema = z.object({
  enabled: z.boolean(),
  expectedVersion: resourceVersionSchema
}).strict();

export const confirmationExecutionSchema = z.object({
  digest: digestSchema,
  acknowledged: z.array(z.string().trim().min(1).max(120)).max(20)
}).strict();

export const permissionPreviewSchema = z.object({
  channel: z.enum(["email", "sms"]),
  status: z.literal("allowed"),
  source: z.string().trim().min(1).max(120),
  reason: z.string().trim().min(1).max(500),
  evidenceReference: z.string().trim().min(1).max(300),
  permissionRecordedAt: z.iso.datetime(),
  expectedVersion: resourceVersionSchema
}).strict();

export const importModeSchema = z.enum(["create_only", "create_or_update"]);

export const importCommitPreviewSchema = z.object({
  expectedSourceDigest: digestSchema,
  expectedPreviewVersion: resourceVersionSchema
}).strict();

export const serviceAccountCreateSchema = z.object({
  name: z.string().trim().min(3).max(120),
  delegatedAdminUserId: z.uuid(),
  scopes: z.array(z.enum(automationScopes)).min(1).max(automationScopes.length),
  expiresAt: z.iso.datetime().nullable().default(null)
}).strict();

export const serviceAccountUpdateSchema = z.object({
  name: z.string().trim().min(3).max(120).optional(),
  delegatedAdminUserId: z.uuid().optional(),
  scopes: z.array(z.enum(automationScopes)).min(1).max(automationScopes.length).optional(),
  isActive: z.boolean().optional(),
  expiresAt: z.iso.datetime().nullable().optional()
}).strict();

export const tokenRotationSchema = z.object({
  expiresAt: z.iso.datetime().nullable().default(null),
  revokePreviousAfterHours: z.union([z.literal(0), z.literal(1), z.literal(24)]).default(0)
}).strict();

export const tokenRevokeSchema = z.object({
  reason: z.string().trim().min(1).max(300).default("Administrative revocation")
}).strict();

export const paymentMatchSchema = z.object({
  fullName: z.string().trim().min(1).max(120),
  email: z.email().transform((value) => value.trim().toLocaleLowerCase()),
  period: z.string().regex(/^\d{4}-\d{2}$/)
}).strict();

export const markRentCollectedSchema = z.object({
  receiptId: z.uuid(),
  collectedAt: z.iso.datetime({ offset: true }).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional()
}).strict();
