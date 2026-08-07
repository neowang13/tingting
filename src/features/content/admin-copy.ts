import type { SectionKey } from "@/lib/contracts";

export const sectionAdminCopy: Record<SectionKey, {
  title: string;
  description: string;
  publicLocation: string;
}> = {
  header: {
    title: "Header and navigation",
    description: "Brand name, main navigation links, and the top contact button.",
    publicLocation: "Top of every website page"
  },
  hero: {
    title: "Homepage introduction",
    description: "The first headline, supporting text, image, and rentals button.",
    publicLocation: "Top of the homepage"
  },
  rental_search: {
    title: "Rental search form",
    description: "Legacy labels retained for compatibility with earlier website versions.",
    publicLocation: "Not currently shown on the public website"
  },
  property_services: {
    title: "Property services",
    description: "Service cards and the detailed information shown for each service.",
    publicLocation: "Services section on the homepage"
  },
  featured_rentals: {
    title: "Featured rentals",
    description: "Heading, introduction, view-all button, and the message shown when no rentals are available.",
    publicLocation: "Featured rentals on the homepage"
  },
  about: {
    title: "About Ting Ting",
    description: "Profile introduction, portrait, and contact call to action.",
    publicLocation: "About section on the homepage"
  },
  contact: {
    title: "Contact form",
    description: "Contact details, form labels, and the success or error messages visitors see.",
    publicLocation: "Contact section on the homepage"
  },
  footer: {
    title: "Footer",
    description: "Business details, social links, office information, and disclosure text.",
    publicLocation: "Bottom of every website page"
  },
  service_trade_services: {
    title: "Trade services",
    description: "Scope, project types, coordination boundaries, benefits, gallery, and final call to action.",
    publicLocation: "/services/trade-services"
  },
  service_property_care: {
    title: "Property care: handyman + maintenance",
    description: "One-time fixes, ongoing upkeep, service boundaries, benefits, gallery, and final call to action.",
    publicLocation: "/services/property-care"
  },
  service_strata: {
    title: "Strata service",
    description: "Hero, four core services, benefits, gallery, and final call to action.",
    publicLocation: "/services/strata-service"
  },
  service_rental_management: {
    title: "Residential & commercial rental management",
    description: "Distinct residential and commercial scopes, shared management support, benefits, workflows, and final call to action.",
    publicLocation: "/services/rental-management"
  }
};

const friendlyFieldLabels: Record<string, string> = {
  alt: "Image description",
  background: "Background image",
  body: "Supporting text",
  brandName: "Business name",
  brandSubtitle: "Business category",
  contactCta: "Contact button",
  cta: "Button",
  ctaLabel: "Button label",
  detail: "Service details",
  disclosureParagraphs: "Disclosure text",
  emptyState: "When no rentals are available",
  errorMessage: "Message when submission fails",
  eyebrow: "Small heading",
  fieldLabels: "Form field labels",
  heading: "Main heading",
  heroImage: "Hero image",
  heroPosition: "Hero image focal point",
  href: "Link destination",
  highlightBody: "Highlight supporting text",
  highlightTitle: "Highlight heading",
  icon: "Icon",
  image: "Image",
  includedHeading: "Included services heading",
  includedItems: "Included services",
  intro: "Introduction",
  key: "Section identifier",
  label: "Link or button label",
  locationLabel: "Location field label",
  locationPlaceholder: "Location example text",
  mediaAssetId: "Image",
  navigation: "Navigation links",
  officeLines: "Office information",
  paragraphs: "Profile paragraphs",
  portrait: "Profile photo",
  preferredContact: "Preferred contact field",
  preferredContactOptions: "Contact method options",
  primaryCta: "Main button",
  primaryCtaLabel: "Main button label",
  processBody: "Process description",
  processHeading: "Process heading",
  publicEmail: "Public email",
  publicPhone: "Public phone",
  secondaryCtaLabel: "Secondary button label",
  services: "Services",
  servicesEyebrow: "Services small heading",
  servicesTitle: "Services heading",
  socialLinks: "Social links",
  submitLabel: "Submit button label",
  successMessage: "Message after successful submission",
  summary: "Short description",
  storyBody: "Why choose us supporting text",
  storyEyebrow: "Why choose us small heading",
  storyImage: "Why choose us image",
  storyTitle: "Why choose us heading",
  title: "Title",
  benefits: "Benefits",
  gallery: "Gallery items",
  galleryEyebrow: "Gallery small heading",
  galleryTitle: "Gallery heading",
  ctaBody: "Final call to action supporting text",
  ctaTitle: "Final call to action heading",
  viewAllCta: "View all rentals button"
};

export function contentFieldLabel(key: string | number) {
  if (typeof key === "number") return `Item ${key + 1}`;
  return friendlyFieldLabels[key] ?? key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .replace(/^./, (value) => value.toUpperCase());
}
