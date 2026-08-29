import { z } from "zod";
import { EMPTY_APPLICATION_DOCUMENT_EXPLANATIONS } from "@/features/applications/contracts";

const optionalText = (maximum: number) => z.string().trim().max(maximum).default("");
const requiredText = (maximum: number, message: string) => z.string().trim().min(1, message).max(maximum);
const phone = z.string().trim().min(7, "Enter a phone number.").max(30);

export const personalDraftSchema = z.object({
  legalFirstName: optionalText(80),
  legalLastName: optionalText(80),
  phone: optionalText(30),
  alternatePhone: optionalText(30),
  email: optionalText(254)
}).strict();

export const tenancyDraftSchema = z.object({
  desiredMoveInDate: optionalText(10),
  leaseTerm: z.enum(["", "month_to_month", "six_months", "one_year", "other"]).default(""),
  occupantCount: z.number().int().min(0).max(12).default(0),
  adultCount: z.number().int().min(1).max(12).nullable().default(null),
  childCount: z.number().int().min(0).max(12).nullable().default(null),
  hasPets: z.boolean().default(false),
  petDetails: optionalText(300),
  needsParking: z.boolean().default(false),
  needsShowing: z.enum(["", "yes", "no"]).default(""),
  reasonForChoosing: optionalText(500)
}).strict().superRefine((value, context) => {
  if (value.adultCount !== null && value.childCount !== null && value.adultCount + value.childCount > 12) {
    context.addIssue({
      code: "custom",
      path: ["childCount"],
      message: "Enter no more than 12 occupants in total."
    });
  }
});

export const housingDraftSchema = z.object({
  currentAddress: optionalText(240),
  currentHousingSince: optionalText(10),
  currentMonthlyRent: z.number().int().min(0).max(100_000).default(0),
  landlordName: optionalText(120),
  landlordPhone: optionalText(30),
  reasonForLeaving: optionalText(500)
}).strict();

export const employmentDraftSchema = z.object({
  employmentStatus: z.enum(["", "employed", "self_employed", "student", "retired", "other"]).default(""),
  employerOrIncomeSource: optionalText(160),
  occupation: optionalText(120),
  employmentSince: optionalText(10),
  grossMonthlyIncome: z.number().int().min(0).max(1_000_000).default(0),
  contactName: optionalText(120),
  contactPhone: optionalText(30)
}).strict();

const referenceDraftSchema = z.object({
  name: optionalText(120),
  relationship: optionalText(80),
  phone: optionalText(30),
  email: optionalText(254)
}).strict();

export const referencesDraftSchema = z.object({
  primary: referenceDraftSchema.prefault({}),
  secondary: referenceDraftSchema.prefault({})
}).strict();

export const emergencyDraftSchema = z.object({
  name: optionalText(120),
  relationship: optionalText(80),
  phone: optionalText(30),
  email: optionalText(254)
}).strict();

export const applicationDraftSchema = z.object({
  personal: personalDraftSchema.prefault({}),
  tenancy: tenancyDraftSchema.prefault({}),
  housing: housingDraftSchema.prefault({}),
  employment: employmentDraftSchema.prefault({}),
  references: referencesDraftSchema.prefault({}),
  emergency: emergencyDraftSchema.prefault({}),
  documentExplanations: z.object({
    rental_payment_history: optionalText(500),
    credit_score_report: optionalText(500),
    employment_income_proof: optionalText(500)
  }).strict().prefault(EMPTY_APPLICATION_DOCUMENT_EXPLANATIONS)
}).strict();

export const applicationTenantConversionSchema = z.object({
  propertyLabel: requiredText(160, "Enter the leased property."),
  unitLabel: z.string().trim().max(60).nullable().default(null),
  moveInDate: z.iso.date("Enter the lease start date."),
  leaseType: z.enum(["month_to_month", "fixed_term"]),
  leaseEndDate: z.iso.date().nullable().default(null),
  rentDueDay: z.number().int().min(1).max(31).default(1)
}).strict().superRefine((value, context) => {
  if (value.leaseType === "fixed_term" && !value.leaseEndDate) {
    context.addIssue({ code: "custom", path: ["leaseEndDate"], message: "Enter the fixed-term lease end date." });
  }
  if (value.leaseType === "month_to_month" && value.leaseEndDate) {
    context.addIssue({ code: "custom", path: ["leaseEndDate"], message: "A month-to-month lease cannot have an end date." });
  }
  if (value.leaseEndDate && value.leaseEndDate <= value.moveInDate) {
    context.addIssue({ code: "custom", path: ["leaseEndDate"], message: "The lease end date must be after the start date." });
  }
});

export type ApplicationTenantConversion = z.infer<typeof applicationTenantConversionSchema>;

export type ApplicationDraft = z.infer<typeof applicationDraftSchema>;
export type ApplicationDraftSection = Exclude<keyof ApplicationDraft, "documentExplanations">;

export const coApplicantInvitationSchema = z.object({
  legalName: requiredText(160, "Enter the co-applicant's legal name."),
  email: z.email("Enter a valid co-applicant email address.").max(254)
}).strict();

export const applicantSignatureSchema = z.object({
  signatureLegalName: requiredText(160, "Type your legal name to sign."),
  sharingAuthorization: z.literal(true),
  screeningConsent: z.literal(true),
  termsVersion: z.string().min(1).max(80),
  termsSha256: z.string().regex(/^[0-9a-f]{64}$/),
  formVersion: z.string().min(1).max(80),
  formSha256: z.string().regex(/^[0-9a-f]{64}$/)
}).strict();

export type CoApplicantInvitationInput = z.infer<typeof coApplicantInvitationSchema>;
export type ApplicantSignatureInput = z.infer<typeof applicantSignatureSchema>;

export const completeApplicationStepSchemas = {
  personal: personalDraftSchema.extend({
    legalFirstName: requiredText(80, "Enter your legal first name."),
    legalLastName: requiredText(80, "Enter your legal last name."),
    phone,
    email: z.email("Enter a valid email address.").max(254)
  }),
  tenancy: tenancyDraftSchema.safeExtend({
    desiredMoveInDate: z.iso.date("Choose a desired move-in date."),
    leaseTerm: z.enum(["month_to_month", "six_months", "one_year", "other"]),
    adultCount: z.number().int().min(1, "Enter at least one adult.").max(12),
    childCount: z.number().int().min(0, "Enter zero if there are no children.").max(12),
    needsShowing: z.enum(["yes", "no"]),
  }).superRefine((value, context) => {
    if (value.hasPets && !value.petDetails) {
      context.addIssue({ code: "custom", path: ["petDetails"], message: "Add a short description of your pets." });
    }
  }),
  housing: housingDraftSchema.extend({
    currentAddress: requiredText(240, "Enter your current address."),
    currentHousingSince: z.string().regex(/^\d{4}-\d{2}$/, "Choose the month you moved in."),
    currentMonthlyRent: z.number().int().min(0).max(100_000),
    landlordName: requiredText(120, "Enter the current landlord or housing contact."),
    landlordPhone: phone,
    reasonForLeaving: requiredText(500, "Enter a brief reason for leaving.")
  }),
  employment: employmentDraftSchema.extend({
    employmentStatus: z.enum(["employed", "self_employed", "student", "retired", "other"]),
    employerOrIncomeSource: requiredText(160, "Enter an employer or income source."),
    occupation: requiredText(120, "Enter an occupation or current role."),
    employmentSince: z.string().regex(/^\d{4}-\d{2}$/, "Choose the starting month."),
    grossMonthlyIncome: z.number().int().min(1, "Enter gross monthly income.").max(1_000_000),
    contactName: requiredText(120, "Enter an employment or income-verification contact."),
    contactPhone: phone
  }),
  references: referencesDraftSchema.superRefine((value, context) => {
    const primary = value.primary;
    if (!primary.name) context.addIssue({ code: "custom", path: ["primary", "name"], message: "Enter a reference name." });
    if (!primary.relationship) context.addIssue({ code: "custom", path: ["primary", "relationship"], message: "Enter the relationship." });
    if (primary.phone.length < 7) context.addIssue({ code: "custom", path: ["primary", "phone"], message: "Enter a reference phone number." });
    if (primary.email && !z.email().safeParse(primary.email).success) {
      context.addIssue({ code: "custom", path: ["primary", "email"], message: "Enter a valid reference email." });
    }
    const secondary = value.secondary;
    const hasSecondary = Object.values(secondary).some(Boolean);
    if (hasSecondary) {
      if (!secondary.name) context.addIssue({ code: "custom", path: ["secondary", "name"], message: "Enter the second reference name." });
      if (!secondary.relationship) context.addIssue({ code: "custom", path: ["secondary", "relationship"], message: "Enter the second relationship." });
      if (secondary.phone.length < 7) context.addIssue({ code: "custom", path: ["secondary", "phone"], message: "Enter the second reference phone number." });
      if (secondary.email && !z.email().safeParse(secondary.email).success) {
        context.addIssue({ code: "custom", path: ["secondary", "email"], message: "Enter a valid second reference email." });
      }
    }
  }),
  emergency: emergencyDraftSchema.extend({
    name: requiredText(120, "Enter an emergency contact name."),
    relationship: requiredText(80, "Enter the relationship."),
    phone,
    email: z.union([z.literal(""), z.email("Enter a valid emergency contact email.").max(254)])
  })
} as const;

export function applicationDraftStepComplete(
  draft: ApplicationDraft,
  section: ApplicationDraftSection
) {
  return completeApplicationStepSchemas[section].safeParse(draft[section]).success;
}

export function applicationDraftStepIssues(
  draft: ApplicationDraft,
  section: ApplicationDraftSection
) {
  const result = completeApplicationStepSchemas[section].safeParse(draft[section]);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

export function validateCompleteApplicationDraft(draft: ApplicationDraft) {
  const issues: Array<{ section: ApplicationDraftSection; message: string }> = [];
  for (const section of Object.keys(completeApplicationStepSchemas) as ApplicationDraftSection[]) {
    const result = completeApplicationStepSchemas[section].safeParse(draft[section]);
    if (!result.success) {
      issues.push({ section, message: result.error.issues[0]?.message ?? "Complete this section." });
    }
  }
  return issues;
}
