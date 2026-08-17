import type {
  NotificationEvent,
  NotificationTemplate,
  ReminderSchedule,
  RentalListing,
  SiteSection,
  Tenant
} from "@/lib/contracts";
import {
  propertyCareService,
  rentalManagementService,
  tradeServicesService,
  upgradePropertyServicesContent
} from "@/features/content/property-services";
import {
  getSeededServicePageContent
} from "@/features/content/service-pages";

const now = "2026-07-24T12:00:00.000Z";
const mediaHero = "10000000-0000-4000-8000-000000000001";
const mediaPortrait = "10000000-0000-4000-8000-000000000002";

const content: Record<SiteSection["key"], unknown> = {
  header: {
    brandName: "TING TING XU",
    brandSubtitle: "REAL ESTATE",
    navigation: [
      { key: "rent", label: "Rent", href: "/#rentals" },
      { key: "service", label: "Services", href: "/#services" },
      { key: "about", label: "About", href: "/#about" }
    ],
    contactCta: { label: "Log in", href: "/client/login" }
  },
  hero: {
    eyebrow: "Managed by TingTing Xu Personal Real Estate Corporation",
    heading: "Find Your Perfect Rental",
    body: "Vancouver rental expertise with local knowledge, fast response and personalized service.",
    background: { mediaAssetId: mediaHero, alt: "Vancouver skyline viewed from a modern home" },
    primaryCta: { label: "View Rentals", href: "/#rentals" }
  },
  rental_search: {
    locationLabel: "Location",
    locationPlaceholder: "City, neighbourhood, or address",
    propertyTypeLabel: "Property Type",
    anyPropertyTypeLabel: "Any Type",
    priceRangeLabel: "Price Range",
    anyPriceLabel: "Any Price",
    bedsLabel: "Beds",
    anyBedsLabel: "Any",
    bathsLabel: "Baths",
    anyBathsLabel: "Any",
    submitLabel: "Search Rentals"
  },
  property_services: {
    eyebrow: "PROPERTY SERVICES",
    heading: "Practical care for every part of your property.",
    body: "Reliable support for repairs, projects, ongoing care, and rental management across Greater Vancouver.",
    services: [
      structuredClone(rentalManagementService),
      structuredClone(tradeServicesService),
      structuredClone(propertyCareService),
      {
        key: "strata",
        title: "Strata Services",
        summary: "Repairs, access, moves, and service coordination for strata properties.",
        ctaLabel: "Strata services",
        detail: {
          eyebrow: "STRATA SERVICES",
          heading: "Responsive support for strata property needs.",
          body: "Coordinate maintenance, repairs, and approved improvements with clear communication.",
          includedHeading: "Strata support includes",
          includedItems: ["Repair coordination", "Maintenance visits", "Trade scheduling", "Status updates"],
          processHeading: "Clear coordination",
          processBody: "We confirm requirements and keep owners, tenants, and service providers aligned.",
          primaryCtaLabel: "Request Strata Support",
          secondaryCtaLabel: "Ask a Question"
        }
      }
    ],
    primaryCta: { label: "Request a Service", href: "/#contact" }
  },
  featured_rentals: {
    eyebrow: "AVAILABLE NOW",
    heading: "Featured Rentals",
    intro: "Selected homes available across Greater Vancouver.",
    viewAllCta: { label: "View All Rentals", href: "/rentals" },
    emptyState: {
      heading: "New rentals are coming soon",
      body: "Contact us and we will help you find the right home.",
      cta: { label: "Get in Touch", href: "/#contact" }
    }
  },
  about: {
    eyebrow: "LOCAL REAL ESTATE SUPPORT",
    heading: "Dedicated to helping you find the right place to call home.",
    paragraphs: [
      "Local market knowledge and responsive service make renting, buying, selling, and caring for a property more straightforward.",
      "Every enquiry receives practical guidance and clear next steps."
    ],
    portrait: { mediaAssetId: mediaPortrait, alt: "Real estate professional Ting Ting Xu" },
    cta: { label: "Contact", href: "/#contact" }
  },
  contact: {
    heading: "How can we help?",
    body: "Send a message about a rental, property service, or real-estate question.",
    publicPhone: "604-872-6896",
    publicEmail: "info@silverkey.ca",
    fieldLabels: {
      name: "Name",
      email: "Email",
      phone: "Phone",
      preferredContact: "Preferred contact",
      message: "Message"
    },
    preferredContactOptions: [
      { key: "email", label: "Email" },
      { key: "phone", label: "Phone" },
      { key: "sms", label: "SMS" }
    ],
    submitLabel: "Send Message",
    successMessage: "Thank you. We will be in touch shortly.",
    errorMessage: "Your message could not be sent. Please try again."
  },
  footer: {
    brandName: "TING TING XU",
    brandSubtitle: "REAL ESTATE",
    summary: "Greater Vancouver rental and property support.",
    phone: "604-872-6896",
    email: "info@silverkey.ca",
    officeLines: ["RE/MAX City Realty", "Vancouver, BC"],
    socialLinks: {
      instagram: "https://www.instagram.com/",
      linkedin: "https://www.linkedin.com/"
    },
    disclosureParagraphs: ["Independent real-estate professional. Information is subject to change."]
  },
  service_trade_services: getSeededServicePageContent("service_trade_services"),
  service_property_care: getSeededServicePageContent("service_property_care"),
  service_strata: getSeededServicePageContent("service_strata"),
  service_rental_management: getSeededServicePageContent("service_rental_management")
};

const sectionNames: Record<SiteSection["key"], string> = {
  header: "Header",
  hero: "Hero",
  rental_search: "Rental Search",
  property_services: "Property Services",
  featured_rentals: "Featured Rentals",
  about: "About",
  contact: "Contact",
  footer: "Footer",
  service_trade_services: "Trade services",
  service_property_care: "Property care: handyman + maintenance",
  service_strata: "Strata service",
  service_rental_management: "Residential & commercial rental management"
};

export const demoSections: SiteSection[] = Object.entries(content).map(([key, value]) => ({
  key: key as SiteSection["key"],
  displayName: sectionNames[key as SiteSection["key"]],
  schemaVersion: key === "property_services" ? 7
    : key === "service_trade_services" || key === "service_rental_management" || key === "service_property_care" ? 2
      : 1,
  draftContent: structuredClone(key === "property_services" ? upgradePropertyServicesContent(value) : value),
  publishedContent: structuredClone(key === "property_services" ? upgradePropertyServicesContent(value) : value),
  publishedAt: now,
  updatedAt: now
}));

export const demoRentals: RentalListing[] = [
  {
    id: "20000000-0000-4000-8000-000000000001",
    slug: "howe-street-one-bedroom",
    title: "Bright Downtown One Bedroom",
    addressLine: "1104 – 1231 Howe Street",
    neighbourhood: "Downtown",
    city: "Vancouver",
    monthlyRentCents: 245000,
    bedrooms: 1,
    bathrooms: 1,
    squareFeet: 620,
    availableOn: "2026-08-01",
    petPolicy: "Ask about pets",
    description: "Bright one-bedroom home with city views and convenient downtown access.",
    status: "published",
    sortOrder: 1,
    coverImageUrl: "https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?auto=format&fit=crop&w=1200&q=80",
    images: [],
    createdAt: now,
    updatedAt: now,
    publishedAt: now
  },
  {
    id: "20000000-0000-4000-8000-000000000002",
    slug: "melville-street-two-bedroom",
    title: "West End Two Bedroom",
    addressLine: "2605 – 1238 Melville Street",
    neighbourhood: "West End",
    city: "Vancouver",
    monthlyRentCents: 320000,
    bedrooms: 2,
    bathrooms: 2,
    squareFeet: 850,
    availableOn: "2026-09-01",
    petPolicy: "Small pets considered",
    description: "Comfortable two-bedroom rental close to shops, transit, and the seawall.",
    status: "published",
    sortOrder: 2,
    coverImageUrl: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=80",
    images: [],
    createdAt: now,
    updatedAt: now,
    publishedAt: now
  }
];

export const demoTenants: Tenant[] = [
  {
    id: "30000000-0000-4000-8000-000000000001",
    fullName: "Demo Tenant",
    propertyLabel: "1231 Howe Street",
    unitLabel: "1104",
    moveInDate: "2026-06-01",
    leaseType: "month_to_month",
    leaseEndDate: null,
    rentDueDay: 1,
    email: "tenant@example.com",
    phoneE164: "+16045550101",
    preferredChannels: ["email", "sms"],
    emailContactStatus: "allowed",
    smsContactStatus: "allowed",
    emailContactStatusReason: null,
    smsContactStatusReason: null,
    emailContactStatusSource: "demo",
    smsContactStatusSource: "demo",
    contactPermissionNote: "Demo permission record.",
    contactPermissionUpdatedAt: now,
    timezone: "America/Vancouver",
    internalNotes: null,
    isActive: true,
    archivedAt: null,
    createdAt: now,
    updatedAt: now
  }
];

export const demoTemplates: NotificationTemplate[] = [
  {
    id: "40000000-0000-4000-8000-000000000001",
    name: "Monthly rent reminder",
    channel: "email",
    subjectTemplate: "Rent reminder for {{property}}",
    bodyTemplate: "Hi {{tenant_name}}, this is a reminder that rent is due on {{due_date}}.",
    isActive: true,
    createdAt: now,
    updatedAt: now
  },
  {
    id: "40000000-0000-4000-8000-000000000002",
    name: "Monthly rent reminder",
    channel: "sms",
    subjectTemplate: null,
    bodyTemplate: "Hi {{tenant_name}}, a reminder that rent for {{property}} is due on {{due_date}}.",
    isActive: true,
    createdAt: now,
    updatedAt: now
  }
];

export const demoSchedules: ReminderSchedule[] = [
  {
    id: "50000000-0000-4000-8000-000000000001",
    tenantId: demoTenants[0].id,
    rentDueDay: 1,
    dayOfMonth: 28,
    localTime: "09:00",
    timezone: "America/Vancouver",
    channels: ["email", "sms"],
    emailTemplateId: demoTemplates[0].id,
    smsTemplateId: demoTemplates[1].id,
    isEnabled: false,
    nextRunAt: null,
    lastProcessedAt: null,
    createdAt: now,
    updatedAt: now
  }
];

export const demoEvents: NotificationEvent[] = [];
