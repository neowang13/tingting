import { z } from "zod";
import { sectionKeys, type SectionKey } from "@/lib/contracts";
import {
  propertyServiceKeys,
  upgradePropertyServicesContent
} from "@/features/content/property-services";
import {
  serviceIconKeys,
  upgradePropertyCareContent,
  upgradeRentalManagementContent,
  upgradeTradeServicesContent
} from "@/features/content/service-pages";

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
  "/#contact",
  "/client/login"
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
    contactCta: z.object({ label: z.literal("Log in"), href: z.literal("/client/login") }).strict()
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

const serviceCardSchema = z
  .object({
    title: z.string().trim().min(1).max(60),
    summary: z.string().trim().min(1).max(180),
    ctaLabel: shortText
  })
  .strict();

const propertyServicesSchema = z.preprocess(
  upgradePropertyServicesContent,
  z.object({
    eyebrow: z.string().trim().min(1).max(80),
    heading: headingText,
    body: bodyText,
    services: z.tuple([
      serviceCardSchema.extend({ key: z.literal(propertyServiceKeys[0]) }),
      serviceCardSchema.extend({ key: z.literal("trade_services") }),
      serviceCardSchema.extend({ key: z.literal("property_care") }),
      serviceCardSchema.extend({ key: z.literal("strata") })
    ]),
    primaryCta: z.object({ label: shortText, href: z.literal("/#contact") }).strict()
  })
  .strict()
);

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

const servicePageCardSchema = z
  .object({
    title: z.string().trim().min(1).max(80),
    body: z.string().trim().min(1).max(240),
    icon: z.enum(serviceIconKeys),
    image: mediaRefSchema.optional()
  })
  .strict();

const servicePageShape = {
  eyebrow: z.string().trim().min(1).max(80),
  title: headingText,
  description: z.string().trim().min(1).max(500),
  heroImage: mediaRefSchema,
  heroPosition: z.string()
    .trim()
    .min(1)
    .max(40)
    .regex(
      /^(?:left|center|right|\d{1,3}%)(?:\s+(?:top|center|bottom|\d{1,3}%))?$/,
      "Choose a valid image focal point."
    ),
  servicesEyebrow: z.string().trim().min(1).max(80),
  servicesTitle: headingText,
  services: z.tuple([
    servicePageCardSchema,
    servicePageCardSchema,
    servicePageCardSchema,
    servicePageCardSchema
  ]),
  highlightTitle: z.string().trim().min(1).max(80),
  highlightBody: z.string().trim().min(1).max(240),
  storyEyebrow: z.string().trim().min(1).max(80),
  storyTitle: headingText,
  storyBody: bodyText,
  storyImage: mediaRefSchema,
  benefits: z.tuple([
    servicePageCardSchema,
    servicePageCardSchema,
    servicePageCardSchema,
    servicePageCardSchema
  ]),
  galleryEyebrow: z.string().trim().min(1).max(80),
  galleryTitle: headingText,
  ctaTitle: headingText,
  ctaBody: z.string().trim().min(1).max(240)
} as const;

const tradeServicesServicePageSchema = z.preprocess(
  upgradeTradeServicesContent,
  z.object({
    ...servicePageShape,
    gallery: z.tuple([
      servicePageCardSchema,
      servicePageCardSchema,
      servicePageCardSchema
    ])
  })
  .strict()
);

const standardServicePageSchema = z
  .object({
    ...servicePageShape,
    gallery: z.tuple([
      servicePageCardSchema,
      servicePageCardSchema,
      servicePageCardSchema,
      servicePageCardSchema
    ])
  })
  .strict();

const rentalManagementTypeSchema = z
  .object({
    title: z.string().trim().min(1).max(80),
    summary: bodyText,
    tasks: z.tuple([bodyText, bodyText, bodyText]),
    intake: bodyText,
    framework: bodyText,
    escalation: bodyText
  })
  .strict();

const rentalManagementServicePageSchema = z.preprocess(
  upgradeRentalManagementContent,
  z.object({
    ...servicePageShape,
    managementTypesEyebrow: z.string().trim().min(1).max(80),
    managementTypesTitle: headingText,
    managementTypes: z.tuple([
      rentalManagementTypeSchema,
      rentalManagementTypeSchema
    ]),
    gallery: z.tuple([
      servicePageCardSchema,
      servicePageCardSchema,
      servicePageCardSchema,
      servicePageCardSchema
    ])
  }).strict()
);

const propertyCareServicePageSchema = z.preprocess(
  upgradePropertyCareContent,
  z.object({
    ...servicePageShape,
    services: z.tuple([
      servicePageCardSchema,
      servicePageCardSchema,
      servicePageCardSchema,
      servicePageCardSchema,
      servicePageCardSchema,
      servicePageCardSchema
    ]),
    gallery: z.tuple([
      servicePageCardSchema,
      servicePageCardSchema,
      servicePageCardSchema,
      servicePageCardSchema
    ])
  }).strict()
);

export const sectionSchemas = {
  header: headerSchema,
  hero: heroSchema,
  rental_search: rentalSearchSchema,
  property_services: propertyServicesSchema,
  featured_rentals: featuredRentalsSchema,
  about: aboutSchema,
  contact: contactSchema,
  footer: footerSchema,
  service_trade_services: tradeServicesServicePageSchema,
  service_property_care: propertyCareServicePageSchema,
  service_strata: standardServicePageSchema,
  service_rental_management: rentalManagementServicePageSchema
} satisfies Record<SectionKey, z.ZodType>;

export const sectionKeySchema = z.enum(sectionKeys);

export function validateSection(key: SectionKey, content: unknown) {
  return sectionSchemas[key].parse(content);
}
