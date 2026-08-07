import type { ServicePageSectionKey } from "@/lib/contracts";

export const serviceIconKeys = [
  "armchair",
  "badge-dollar",
  "bath",
  "building",
  "calendar",
  "check",
  "clipboard",
  "clock",
  "door",
  "drill",
  "droplets",
  "file-chart",
  "flower",
  "hammer",
  "handshake",
  "hard-hat",
  "house",
  "key",
  "leaf",
  "lightbulb",
  "mail",
  "message",
  "paint",
  "panel",
  "phone",
  "plug",
  "search",
  "shield",
  "snowflake",
  "sparkles",
  "users",
  "wrench"
] as const;

export type ServiceIconKey = (typeof serviceIconKeys)[number];

export interface ServiceMediaReference {
  mediaAssetId: string;
  alt: string;
}

export interface ServicePageCard {
  title: string;
  body: string;
  icon: ServiceIconKey;
  image?: ServiceMediaReference;
}

export interface RentalManagementType {
  title: string;
  summary: string;
  tasks: [string, string, string];
  intake: string;
  framework: string;
  escalation: string;
}

export interface ServicePageContent {
  eyebrow: string;
  title: string;
  description: string;
  heroImage: ServiceMediaReference;
  heroPosition: string;
  managementTypesEyebrow?: string;
  managementTypesTitle?: string;
  managementTypes?: [RentalManagementType, RentalManagementType];
  servicesEyebrow: string;
  servicesTitle: string;
  services: ServicePageCard[];
  highlightTitle: string;
  highlightBody: string;
  storyEyebrow: string;
  storyTitle: string;
  storyBody: string;
  storyImage: ServiceMediaReference;
  benefits: [ServicePageCard, ServicePageCard, ServicePageCard, ServicePageCard];
  galleryEyebrow: string;
  galleryTitle: string;
  gallery: ServicePageCard[];
  ctaTitle: string;
  ctaBody: string;
}

export interface ServicePageDefinition {
  sectionKey: ServicePageSectionKey;
  slug: string;
  displayName: string;
  content: ServicePageContent;
}

const mediaIds = {
  kitchen: "11000000-0000-4000-8000-000000000001",
  living: "11000000-0000-4000-8000-000000000002",
  bathroom: "11000000-0000-4000-8000-000000000003",
  condo: "11000000-0000-4000-8000-000000000004",
  furniture: "11000000-0000-4000-8000-000000000005",
  tools: "11000000-0000-4000-8000-000000000006",
  construction: "11000000-0000-4000-8000-000000000007",
  garden: "11000000-0000-4000-8000-000000000008",
  house: "11000000-0000-4000-8000-000000000009",
  apartment: "11000000-0000-4000-8000-000000000010",
  city: "11000000-0000-4000-8000-000000000011",
  rental: "11000000-0000-4000-8000-000000000012",
  office: "11000000-0000-4000-8000-000000000013",
  paperwork: "11000000-0000-4000-8000-000000000014"
} as const;

function image(mediaAssetId: string, alt: string): ServiceMediaReference {
  return { mediaAssetId, alt };
}

const propertyCareContent: ServicePageContent = {
  eyebrow: "PROPERTY CARE · HANDYMAN + MAINTENANCE",
  title: "One-Time Fixes and Ongoing Property Upkeep.",
  description:
    "Property-care requests are reviewed before scheduling so the scope, provider, approvals, and next step are clear. Specialized or regulated work is referred to or coordinated with an appropriately qualified provider where required.",
  heroImage: image(mediaIds.tools, "Tools and supplies prepared for a property-care assessment"),
  heroPosition: "center 58%",
  servicesEyebrow: "ONE-TIME AND ONGOING PROPERTY CARE",
  servicesTitle: "Two kinds of support, one clear request path.",
  services: [
    {
      title: "One-Time Fixes · Mounting & Assembly",
      body: "Requests for furniture assembly, shelving, mirrors, artwork, and similar non-regulated installations can be assessed for an appropriate service provider.",
      icon: "panel"
    },
    {
      title: "One-Time Fixes · Walls, Doors & Hardware",
      body: "Drywall touch-ups, minor paint repairs, door adjustments, handles, hinges, and cabinet hardware can be scoped before scheduling.",
      icon: "door"
    },
    {
      title: "One-Time Fixes · Minor Fixture Support",
      body: "Minor caulking, sealing, fixture, faucet, or drain requests are assessed first; regulated plumbing or electrical work is directed to a qualified trade.",
      icon: "droplets"
    },
    {
      title: "Ongoing Upkeep · Cleaning & Exterior Care",
      body: "One-time or recurring cleaning and exterior-care requests can be coordinated after access, surfaces, safety limits, and approvals are confirmed.",
      icon: "sparkles"
    },
    {
      title: "Ongoing Upkeep · Lawn & Seasonal Tasks",
      body: "Lawn care, pruning, leaf or gutter clearing, weather preparation, and seasonal clean-up are considered according to the property and season.",
      icon: "flower"
    },
    {
      title: "Ongoing Upkeep · Preventive Property Checks",
      body: "Agreed visual checks can identify concerns for owner review; inspections, diagnosis, and regulated work remain with the appropriate qualified professional.",
      icon: "clipboard"
    }
  ],
  highlightTitle: "Scope and responsibility are confirmed first.",
  highlightBody:
    "Availability, geography, provider relationship, estimate, payment, insurance, warranties, safety rules, strata or owner approvals, and emergency limitations must be confirmed for each request.",
  storyEyebrow: "HOW PROPERTY CARE IS COORDINATED",
  storyTitle: "The Right Provider for the Approved Scope.",
  storyBody:
    "We help review the request and coordinate an appropriate next step. Each service provider remains responsible for its own work, qualifications, insurance, quote, payment terms, safety practices, and warranties unless a written agreement states otherwise. This service is not an emergency-response line.",
  storyImage: image(mediaIds.house, "Home exterior reviewed for ongoing property-care needs"),
  benefits: [
    { title: "Request Review", body: "Photos, timing, access, property context, and the requested outcome help define the next step.", icon: "search" },
    { title: "Written Scope", body: "Included work, exclusions, provider, estimate, approvals, and follow-up path can be confirmed before scheduling.", icon: "file-chart" },
    { title: "Qualified-Provider Boundary", body: "Specialized or regulated work is referred to or coordinated with an appropriately qualified provider.", icon: "hard-hat" },
    { title: "Approval Awareness", body: "Owner, strata, municipal, and other required permissions remain part of the request assessment.", icon: "shield" }
  ],
  galleryEyebrow: "PROPERTY-CARE REQUESTS",
  galleryTitle: "Examples of requests we can assess.",
  gallery: [
    { title: "Mounting & Assembly", body: "One-time household installation and assembly requests.", icon: "panel", image: image(mediaIds.living, "Living room representing mounting and assembly requests") },
    { title: "Doors, Walls & Fixtures", body: "Minor repair requests reviewed for safe scope and provider needs.", icon: "door", image: image(mediaIds.furniture, "Interior door and hardware representing minor repair requests") },
    { title: "Exterior & Seasonal Care", body: "Property-specific outdoor and seasonal upkeep requests.", icon: "flower", image: image(mediaIds.garden, "Garden representing seasonal property-care requests") },
    { title: "Preventive Checks", body: "Documented visual checks with concerns escalated for appropriate follow-up.", icon: "clipboard", image: image(mediaIds.house, "Home exterior representing preventive property checks") }
  ],
  ctaTitle: "Discuss a Property-Care Request",
  ctaBody: "Describe the property, requested work, timing, access, and known approvals so the scope and appropriate next step can be confirmed."
};

export function upgradePropertyCareContent(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const content = value as Record<string, unknown>;
  if (content.eyebrow === propertyCareContent.eyebrow && Array.isArray(content.services)) return value;
  if (!Array.isArray(content.services) || ![4, 5].includes(content.services.length)) return value;

  const upgraded = structuredClone(propertyCareContent);
  preserveMediaId(upgraded.heroImage, content.heroImage);
  preserveMediaId(upgraded.storyImage, content.storyImage);
  if (typeof content.heroPosition === "string") upgraded.heroPosition = content.heroPosition;
  if (Array.isArray(content.gallery)) {
    const legacyGallery = content.gallery as unknown[];
    upgraded.gallery.forEach((item, index) => {
      if (!item.image) return;
      const prior = legacyGallery[index];
      if (prior && typeof prior === "object" && !Array.isArray(prior)) {
        preserveMediaId(item.image, (prior as Record<string, unknown>).image);
      }
    });
  }
  return upgraded;
}

const tradeServicesContent: ServicePageContent = {
  eyebrow: "TRADE SERVICES",
  title: "A Clear First Step for Property Projects.",
  description:
    "Tell us what your property needs. We’ll assess the request, confirm the available scope, and explain whether the next step is coordination or a referral to an appropriate qualified trade.",
  heroImage: image(mediaIds.kitchen, "Kitchen used as an example of a property project"),
  heroPosition: "center 54%",
  servicesEyebrow: "HOW REQUESTS ARE ASSESSED",
  servicesTitle: "Clear scope before work begins.",
  services: [
    {
      title: "Project Assessment",
      body: "Review the request, property context, photos, timing, and any strata requirements before recommending a next step.",
      icon: "clipboard",
      image: image(mediaIds.kitchen, "Property project assessment for a kitchen")
    },
    {
      title: "Trade Referrals",
      body: "Connect you with an appropriate qualified trade when specialized or regulated work is required.",
      icon: "hard-hat",
      image: image(mediaIds.bathroom, "Bathroom fixtures reviewed for a trade-services request")
    },
    {
      title: "Scheduling Coordination",
      body: "Help align approved work, access, and communication among the property contact and service provider.",
      icon: "calendar",
      image: image(mediaIds.condo, "Condominium access considered during project coordination")
    },
    {
      title: "Scope & Quote Review",
      body: "Clarify who will define the work, provide the quote, collect payment, and address follow-up before work begins.",
      icon: "file-chart",
      image: image(mediaIds.living, "Living space reviewed while defining project scope")
    }
  ],
  highlightTitle: "Scope comes before scheduling.",
  highlightBody:
    "Each request is assessed individually. Availability, service area, provider, permits, insurance, pricing, payment, warranties, and approvals must be confirmed for the specific project.",
  storyEyebrow: "TING TING’S ROLE",
  storyTitle: "Coordination With Clear Boundaries.",
  storyBody:
    "We help identify the next practical step and, when appropriate, coordinate communication with the service provider. The provider remains responsible for its own quote, trade work, licensing, insurance, permits, warranties, and workmanship unless a written agreement states otherwise.",
  storyImage: image(mediaIds.living, "Property interior reviewed for trade-services coordination"),
  benefits: [
    { title: "Request Review", body: "The property, timing, access, and requested outcome are reviewed before a next step is suggested.", icon: "search" },
    { title: "Written Next Steps", body: "The proposed provider, responsibilities, approvals, and contact path can be confirmed before scheduling.", icon: "message" },
    { title: "Qualified-Trade Boundary", body: "Specialized or regulated work is directed to an appropriately qualified provider.", icon: "hard-hat" },
    { title: "Approval Awareness", body: "Owner, strata, municipal, and other required approvals remain part of the project assessment.", icon: "shield" }
  ],
  galleryEyebrow: "PROJECT REQUESTS",
  galleryTitle: "Examples we can assess.",
  gallery: [
    {
      title: "Interior Projects",
      body: "Requests involving kitchens, bathrooms, finishes, fixtures, or room updates.",
      icon: "panel",
      image: image(mediaIds.kitchen, "Kitchen representing an interior project request")
    },
    {
      title: "Building Systems",
      body: "Electrical, plumbing, HVAC, and other regulated work requiring an appropriate qualified provider.",
      icon: "wrench",
      image: image(mediaIds.bathroom, "Plumbing fixtures representing a building-systems request")
    },
    {
      title: "Exterior & Common Property",
      body: "Requests that may need owner, strata, municipal, or other approval before coordination.",
      icon: "building",
      image: image(mediaIds.condo, "Condominium exterior representing an approval-dependent request")
    }
  ],
  ctaTitle: "Request a Trade-Services Assessment",
  ctaBody: "Describe the property, requested work, timing, and known approvals so we can confirm an appropriate next step."
};

function preserveMediaId(target: ServiceMediaReference, value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const mediaAssetId = (value as Record<string, unknown>).mediaAssetId;
  if (typeof mediaAssetId === "string") target.mediaAssetId = mediaAssetId;
}

/**
 * Reset compliance-sensitive Renovation copy while retaining administrator-
 * selected media and focal position during the section-key migration.
 */
export function migrateRenovationServiceContent(value: unknown): ServicePageContent {
  const migrated = structuredClone(tradeServicesContent);
  if (!value || typeof value !== "object" || Array.isArray(value)) return migrated;

  const legacy = value as Record<string, unknown>;
  preserveMediaId(migrated.heroImage, legacy.heroImage);
  preserveMediaId(migrated.storyImage, legacy.storyImage);
  if (typeof legacy.heroPosition === "string") migrated.heroPosition = legacy.heroPosition;

  const legacyServices = legacy.services;
  if (Array.isArray(legacyServices)) {
    migrated.services.forEach((service, index) => {
      if (!service.image) return;
      const legacyService = legacyServices[index];
      if (legacyService && typeof legacyService === "object" && !Array.isArray(legacyService)) {
        preserveMediaId(service.image, (legacyService as Record<string, unknown>).image);
      }
    });
  }
  const legacyGallery = legacy.gallery;
  if (Array.isArray(legacyGallery)) {
    migrated.gallery.forEach((item, index) => {
      if (!item.image) return;
      const legacyItem = legacyGallery[index];
      if (legacyItem && typeof legacyItem === "object" && !Array.isArray(legacyItem)) {
        preserveMediaId(item.image, (legacyItem as Record<string, unknown>).image);
      }
    });
  }

  return migrated;
}

export function upgradeTradeServicesContent(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const content = value as Record<string, unknown>;
  const hasLegacyIdentity = content.eyebrow === "RENOVATION SERVICES" ||
    (typeof content.title === "string" && /renovat/i.test(content.title));
  return hasLegacyIdentity ? migrateRenovationServiceContent(value) : value;
}

export const rentalManagementContent: ServicePageContent = {
  eyebrow: "RESIDENTIAL & COMMERCIAL RENTAL MANAGEMENT",
  title: "Rental Management for Homes and Commercial Properties.",
  description:
    "Residential and commercial rental-management support in Greater Vancouver, with responsibilities, authority, fees, and next steps confirmed for each property before service begins.",
  heroImage: image(mediaIds.rental, "Rental property represented by a modern building exterior"),
  heroPosition: "center 56%",
  managementTypesEyebrow: "TWO RENTAL CONTEXTS",
  managementTypesTitle: "Different properties require different management plans.",
  managementTypes: [
    {
      title: "Residential Rental Management",
      summary:
        "Support for homes and residential tenancies is scoped to the property, the owner’s authority, and applicable brokerage requirements before any work begins.",
      tasks: [
        "Coordinate approved marketing, enquiries, showings, application information, and tenancy documentation.",
        "Track rent administration, scheduled condition inspections, notices, records, and owner reporting within the agreed scope.",
        "Receive tenant requests and coordinate approved access, maintenance, and qualified providers when specialized work is required."
      ],
      intake:
        "Property type and location, occupancy and tenancy status, rent and deposit records, strata rules, known repairs, service authority, and owner priorities.",
      framework:
        "Work must follow the BC Residential Tenancy Act and regulations, brokerage policies, the management agreement, and lawful owner instructions. Legal advice and unapproved work are excluded.",
      escalation:
        "Life-safety emergencies go to emergency services or the appropriate utility. Disputes, legal questions, regulated work, and costs beyond approved authority are escalated to the owner or an appropriate professional."
    },
    {
      title: "Commercial Rental Management",
      summary:
        "Support for offices, retail, and other approved commercial spaces is built around the negotiated lease and a written property-specific scope.",
      tasks: [
        "Coordinate approved leasing enquiries, showings, applicant information, possession details, renewals, and lease-administration milestones.",
        "Track base rent, additional-rent or operating-cost information, records, and owner reporting as defined by the lease and management agreement.",
        "Coordinate tenant access, service requests, vendors, and owner-approved maintenance while recording responsibilities under the lease."
      ],
      intake:
        "Property and permitted use, lease status and key dates, rent and operating-cost terms, access rules, insurance requirements, service contracts, authority limits, and owner priorities.",
      framework:
        "Commercial work follows the negotiated lease, applicable laws, brokerage policies, and written owner authority; residential-tenancy rules do not govern commercial leases. Legal, tax, and accounting advice are excluded.",
      escalation:
        "Defaults, disputes, environmental or life-safety issues, regulated work, and decisions outside approved authority are referred to the owner and the appropriate legal, accounting, emergency, or qualified service professional."
    }
  ],
  servicesEyebrow: "SHARED MANAGEMENT SUPPORT",
  servicesTitle: "A documented plan for day-to-day coordination.",
  services: [
    { title: "Leasing & Onboarding", body: "Coordinate approved marketing, enquiries, documentation, access, and move-in or possession steps for the property type.", icon: "users" },
    { title: "Rent Administration & Reporting", body: "Track agreed rent information, records, follow-up, and owner reports without making unapproved financial or legal decisions.", icon: "file-chart" },
    { title: "Property Checks & Maintenance", body: "Coordinate agreed inspections, service requests, access, and qualified providers within documented authority limits.", icon: "wrench" },
    { title: "Communication & Escalation", body: "Keep owners and occupants informed, document material issues, and escalate emergencies, disputes, and out-of-scope decisions.", icon: "message" }
  ],
  highlightTitle: "Scope is confirmed before management begins.",
  highlightBody:
    "Property type, geography, fees, availability, money handling, repair authority, reporting, and the responsible service entity must be approved in writing for each engagement.",
  storyEyebrow: "HOW THE SERVICE IS DEFINED",
  storyTitle: "Clear Authority. Documented Responsibilities.",
  storyBody:
    "The owner, brokerage, and service provider confirm who may act, what is included, how records and funds are handled, and when approval or specialist help is required. No page can replace the property-specific management agreement or lease.",
  storyImage: image(mediaIds.city, "Greater Vancouver skyline with residential and commercial buildings"),
  benefits: [
    { title: "Property-Specific Intake", body: "Start with the property, lease or tenancy, current records, risks, and owner priorities.", icon: "clipboard" },
    { title: "Written Scope", body: "Document included work, exclusions, fees, authority limits, availability, and reporting expectations.", icon: "file-chart" },
    { title: "Approval Controls", body: "Refer costs, notices, disputes, regulated work, and other material decisions to the appropriate approver.", icon: "shield" },
    { title: "Recorded Communication", body: "Maintain practical updates and records for owners, occupants, providers, and approved professionals.", icon: "message" }
  ],
  galleryEyebrow: "MANAGEMENT WORKFLOWS",
  galleryTitle: "Examples of property-specific coordination.",
  gallery: [
    { title: "Residential Leasing", body: "Approved enquiries, showing access, applicant information, and tenancy documentation.", icon: "users", image: image(mediaIds.office, "Office setting for a residential leasing consultation") },
    { title: "Commercial Lease Administration", body: "Key dates, possession details, rent terms, records, and lease-specific owner approvals.", icon: "building", image: image(mediaIds.paperwork, "Commercial lease administration documents") },
    { title: "Property Access & Maintenance", body: "Documented access, requests, authority limits, and qualified-provider coordination.", icon: "wrench", image: image(mediaIds.tools, "Maintenance tools used for rental property coordination") },
    { title: "Reporting & Escalation", body: "Owner updates, supporting records, open decisions, and referrals for out-of-scope issues.", icon: "file-chart", image: image(mediaIds.paperwork, "Rental property reports and supporting records") }
  ],
  ctaTitle: "Discuss Your Residential or Commercial Rental",
  ctaBody:
    "Tell us about the property, current tenancy or lease, timing, and support needed so the appropriate scope and next step can be confirmed."
};

/**
 * Add the residential/commercial contract to historical CMS content while
 * retaining administrator-selected media and focal position. Revisions remain
 * readable because they pass through the same upgrade before validation.
 */
export function upgradeRentalManagementContent(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const content = value as Record<string, unknown>;
  if (Array.isArray(content.managementTypes)) return value;

  const upgraded = structuredClone(rentalManagementContent);
  preserveMediaId(upgraded.heroImage, content.heroImage);
  preserveMediaId(upgraded.storyImage, content.storyImage);
  if (typeof content.heroPosition === "string") upgraded.heroPosition = content.heroPosition;
  if (Array.isArray(content.gallery)) {
    upgraded.gallery.forEach((item, index) => {
      if (!item.image) return;
      const legacyItem = content.gallery as unknown[];
      const prior = legacyItem[index];
      if (prior && typeof prior === "object" && !Array.isArray(prior)) {
        preserveMediaId(item.image, (prior as Record<string, unknown>).image);
      }
    });
  }
  return upgraded;
}

export const servicePageDefinitions: readonly ServicePageDefinition[] = [
  {
    sectionKey: "service_trade_services",
    slug: "trade-services",
    displayName: "Trade Services",
    content: tradeServicesContent
  },
  {
    sectionKey: "service_property_care",
    slug: "property-care",
    displayName: "Property Care: Handyman + Maintenance",
    content: propertyCareContent
  },
  {
    sectionKey: "service_strata",
    slug: "strata-service",
    displayName: "Strata service",
    content: {
      eyebrow: "STRATA SERVICES",
      title: "Practical Support for Strata Property Needs.",
      description:
        "From repairs and maintenance to move-in and move-out support, we help you navigate the everyday needs of your strata property with ease.",
      heroImage: image(mediaIds.apartment, "Modern strata apartment building"),
      heroPosition: "center 56%",
      servicesEyebrow: "STRATA SERVICES WE PROVIDE",
      servicesTitle: "Reliable help for your strata property.",
      services: [
        { title: "Repair Coordination", body: "Assign, schedule, monitor, and document approved repairs with trusted contractors.", icon: "wrench" },
        { title: "Unit & Common-Area Upkeep", body: "Coordinate cleaning, minor maintenance, safety checks, and common-area requests.", icon: "building" },
        { title: "Move & Vendor Access", body: "Arrange bookings, keys, notices, and compliant access for moves, inspections, or service visits.", icon: "key" },
        { title: "Strata Communication & Approvals", body: "Keep owners, tenants, strata management, and vendors aligned on rules and approved work.", icon: "message" }
      ],
      highlightTitle: "Local expertise. Smoother living.",
      highlightBody: "We understand Metro Vancouver strata processes and help reduce unnecessary stress.",
      storyEyebrow: "WHY CHOOSE US",
      storyTitle: "Your Property. Our Priority.",
      storyBody:
        "Strata living comes with rules and responsibilities. We help you handle the details so you can enjoy your home without the hassle.",
      storyImage: image(mediaIds.apartment, "Modern strata apartment building entrance"),
      benefits: [
        { title: "Strata Knowledge", body: "Familiar with strata bylaws and processes across Metro Vancouver.", icon: "building" },
        { title: "Save Time", body: "We handle the coordination so you don’t have to.", icon: "clock" },
        { title: "Trusted Network", body: "Reliable vendors and service providers you can trust.", icon: "handshake" },
        { title: "Clear Communication", body: "You’ll always know what is happening with your property.", icon: "message" }
      ],
      galleryEyebrow: "COMMON STRATA REQUESTS",
      galleryTitle: "Everyday needs, expertly coordinated.",
      gallery: [
        { title: "Plumbing & Leaks", body: "Responsive repair coordination.", icon: "droplets", image: image(mediaIds.bathroom, "Bathroom plumbing fixtures") },
        { title: "Amenities & Access", body: "Bookings, keys, and moving support.", icon: "key", image: image(mediaIds.apartment, "Strata building common area") },
        { title: "Inspections", body: "Clear scheduling and follow-up.", icon: "clipboard", image: image(mediaIds.office, "Building inspection and administration") },
        { title: "Cleaning Requests", body: "Unit and common-area care.", icon: "sparkles", image: image(mediaIds.living, "Clean residential common area") }
      ],
      ctaTitle: "Need Help With Your Strata Property?",
      ctaBody: "Let us take care of the details so you can enjoy peace of mind."
    }
  },
  {
    sectionKey: "service_rental_management",
    slug: "rental-management",
    displayName: "Residential & Commercial Rental Management",
    content: rentalManagementContent
  }
];

export function getAllServicePages() {
  return servicePageDefinitions;
}

export function getServicePageDefinitionBySlug(slug: string) {
  return servicePageDefinitions.find((page) => page.slug === slug);
}

export function getServicePageDefinitionByKey(key: ServicePageSectionKey) {
  return servicePageDefinitions.find((page) => page.sectionKey === key);
}

export function getSeededServicePageContent(key: ServicePageSectionKey) {
  const page = getServicePageDefinitionByKey(key);
  if (!page) throw new Error(`Missing seeded service page content for ${key}.`);
  return structuredClone(page.content);
}
