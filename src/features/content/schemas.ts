import { z } from "zod";
import { sectionKeys, type SectionKey } from "@/lib/contracts";

const shortText = z.string().trim().min(1).max(40);
const headingText = z.string().trim().min(1).max(120);
const bodyText = z.string().trim().min(1).max(500);
const altText = z.string().trim().min(1).max(160);
const httpsUrl = z.url().refine((value) => value.startsWith("https://"));
const internalHref = z.enum([
  "/",
  "/rentals",
  "/#rentals",
  "/#services",
  "/#about",
  "/#contact"
]);

const mediaRefSchema = z
  .object({
    mediaAssetId: z.uuid(),
    alt: altText
  })
  .strict();

const ctaSchema = z.object({ label: shortText, href: internalHref }).strict();

const headerSchema = z
  .object({
    brandName: z.string().trim().min(1).max(60),
    brandSubtitle: z.string().trim().min(1).max(60),
    navigation: z.tuple([
      z.object({ key: z.literal("rent"), label: shortText, href: z.literal("/#rentals") }).strict(),
      z.object({ key: z.literal("service"), label: shortText, href: z.literal("/#services") }).strict(),
      z.object({ key: z.literal("about"), label: shortText, href: z.literal("/#about") }).strict()
    ]),
    contactCta: z.object({ label: shortText, href: z.literal("/#contact") }).strict()
  })
  .strict();

const heroSchema = z
  .object({
    eyebrow: z.string().trim().min(1).max(80),
    heading: headingText,
    body: z.string().trim().min(1).max(300),
    background: mediaRefSchema,
    primaryCta: z.object({ label: shortText, href: z.literal("/#rentals") }).strict()
  })
  .strict();

const rentalSearchSchema = z
  .object({
    locationLabel: shortText,
    locationPlaceholder: z.string().trim().min(1).max(80),
    propertyTypeLabel: shortText,
    anyPropertyTypeLabel: shortText,
    priceRangeLabel: shortText,
    anyPriceLabel: shortText,
    bedsLabel: shortText,
    anyBedsLabel: shortText,
    bathsLabel: shortText,
    anyBathsLabel: shortText,
    submitLabel: shortText
  })
  .strict();

const serviceDetailSchema = z
  .object({
    eyebrow: z.string().trim().min(1).max(80),
    heading: headingText,
    body: bodyText,
    includedHeading: shortText,
    includedItems: z.array(z.string().trim().min(1).max(120)).min(1).max(8),
    processHeading: shortText,
    processBody: bodyText,
    primaryCtaLabel: shortText,
    secondaryCtaLabel: shortText
  })
  .strict();

const serviceCardSchema = z
  .object({
    title: z.string().trim().min(1).max(60),
    summary: z.string().trim().min(1).max(180),
    ctaLabel: shortText,
    detail: serviceDetailSchema
  })
  .strict();

const propertyServicesSchema = z
  .object({
    eyebrow: z.string().trim().min(1).max(80),
    heading: headingText,
    body: bodyText,
    services: z.tuple([
      serviceCardSchema.extend({ key: z.literal("renovation") }),
      serviceCardSchema.extend({ key: z.literal("handyman") }),
      serviceCardSchema.extend({ key: z.literal("maintenance") }),
      serviceCardSchema.extend({ key: z.literal("strata") })
    ]),
    primaryCta: z.object({ label: shortText, href: z.literal("/#contact") }).strict()
  })
  .strict();

const featuredRentalsSchema = z
  .object({
    eyebrow: z.string().trim().min(1).max(80).optional(),
    heading: headingText,
    intro: bodyText.optional(),
    viewAllCta: z.object({ label: shortText, href: z.literal("/rentals") }).strict(),
    emptyState: z
      .object({
        heading: headingText,
        body: bodyText,
        cta: z.object({ label: shortText, href: z.literal("/#contact") }).strict()
      })
      .strict()
  })
  .strict();

const aboutSchema = z
  .object({
    eyebrow: z.string().trim().min(1).max(80),
    heading: headingText,
    paragraphs: z.array(z.string().trim().min(1).max(1000)).min(1).max(3),
    portrait: mediaRefSchema,
    cta: ctaSchema.optional()
  })
  .strict();

const contactSchema = z
  .object({
    heading: headingText,
    body: bodyText,
    publicPhone: z.string().trim().min(7).max(30),
    publicEmail: z.email(),
    fieldLabels: z
      .object({
        name: shortText,
        email: shortText,
        phone: shortText,
        preferredContact: shortText,
        message: shortText
      })
      .strict(),
    preferredContactOptions: z.tuple([
      z.object({ key: z.literal("email"), label: shortText }).strict(),
      z.object({ key: z.literal("phone"), label: shortText }).strict(),
      z.object({ key: z.literal("sms"), label: shortText }).strict()
    ]),
    submitLabel: shortText,
    successMessage: z.string().trim().min(1).max(240),
    errorMessage: z.string().trim().min(1).max(240)
  })
  .strict();

const footerSchema = z
  .object({
    brandName: z.string().trim().min(1).max(60),
    brandSubtitle: z.string().trim().min(1).max(60),
    summary: z.string().trim().min(1).max(240),
    phone: z.string().trim().min(7).max(30),
    email: z.email(),
    officeLines: z.array(z.string().trim().min(1).max(120)).min(1).max(4),
    socialLinks: z
      .object({
        facebook: httpsUrl.optional(),
        instagram: httpsUrl.optional(),
        linkedin: httpsUrl.optional()
      })
      .strict(),
    disclosureParagraphs: z.array(z.string().trim().min(1).max(1200)).min(1).max(3)
  })
  .strict();

export const sectionSchemas = {
  header: headerSchema,
  hero: heroSchema,
  rental_search: rentalSearchSchema,
  property_services: propertyServicesSchema,
  featured_rentals: featuredRentalsSchema,
  about: aboutSchema,
  contact: contactSchema,
  footer: footerSchema
} satisfies Record<SectionKey, z.ZodType>;

export const sectionKeySchema = z.enum(sectionKeys);

export function validateSection(key: SectionKey, content: unknown) {
  return sectionSchemas[key].parse(content);
}
