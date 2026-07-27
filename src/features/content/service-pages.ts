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

export interface ServicePageContent {
  eyebrow: string;
  title: string;
  description: string;
  heroImage: ServiceMediaReference;
  heroPosition: string;
  servicesEyebrow: string;
  servicesTitle: string;
  services: [ServicePageCard, ServicePageCard, ServicePageCard, ServicePageCard];
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

export const servicePageDefinitions: readonly ServicePageDefinition[] = [
  {
    sectionKey: "service_renovation",
    slug: "renovation",
    displayName: "Renovation",
    content: {
      eyebrow: "RENOVATION SERVICES",
      title: "Renovations Designed Around Your Home.",
      description:
        "Whether you’re updating a single room or planning a complete home transformation, we coordinate every stage—from planning and design to construction and finishing.",
      heroImage: image(mediaIds.kitchen, "Modern renovated kitchen and living area"),
      heroPosition: "center 54%",
      servicesEyebrow: "RENOVATION SERVICES",
      servicesTitle: "Thoughtful upgrades for every room.",
      services: [
        {
          title: "Kitchen Renovation",
          body: "Functional layouts, cabinetry, counters, lighting, and finishes.",
          icon: "panel",
          image: image(mediaIds.kitchen, "Modern kitchen renovation")
        },
        {
          title: "Bathroom Renovation",
          body: "Comfortable, modern spaces with practical layouts and quality finishes.",
          icon: "bath",
          image: image(mediaIds.bathroom, "Bright modern bathroom")
        },
        {
          title: "Condo Renovation",
          body: "Efficient updates planned around strata requirements and condo living.",
          icon: "building",
          image: image(mediaIds.condo, "Updated contemporary condominium")
        },
        {
          title: "Full Home Renovation",
          body: "Coordinated design, construction, and finishing for an entire home.",
          icon: "house",
          image: image(mediaIds.living, "Warm renovated living room")
        }
      ],
      highlightTitle: "Planning a renovation?",
      highlightBody: "Tell us what you want to change and we’ll help define a clear, practical next step.",
      storyEyebrow: "WHY RENOVATE WITH US",
      storyTitle: "More Than Just Renovation.",
      storyBody:
        "A successful renovation is about more than choosing finishes. It’s about creating a home that works better for your lifestyle today while adding long-term value for tomorrow.",
      storyImage: image(mediaIds.living, "Warm, newly renovated living room"),
      benefits: [
        { title: "Personalized Planning", body: "Every project begins with your goals, budget, and timeline.", icon: "clipboard" },
        { title: "Trusted Professionals", body: "Experienced contractors and skilled trades across Metro Vancouver.", icon: "hard-hat" },
        { title: "Clear Communication", body: "Transparent updates and coordinated scheduling at every stage.", icon: "message" },
        { title: "Quality That Lasts", body: "Materials and workmanship selected for everyday living.", icon: "shield" }
      ],
      galleryEyebrow: "FEATURED SPACES",
      galleryTitle: "Renovation inspiration.",
      gallery: [
        {
          title: "Kitchen",
          body: "Warm, functional gathering spaces.",
          icon: "panel",
          image: image(mediaIds.kitchen, "Open modern kitchen")
        },
        {
          title: "Bathroom",
          body: "Calm finishes and practical storage.",
          icon: "bath",
          image: image(mediaIds.bathroom, "Calm modern bathroom")
        },
        {
          title: "Living Room",
          body: "Comfortable rooms designed for real life.",
          icon: "armchair",
          image: image(mediaIds.living, "Comfortable renovated living room")
        }
      ],
      ctaTitle: "Ready to Transform Your Home?",
      ctaBody: "We’re here to help you plan your next project with confidence."
    }
  },
  {
    sectionKey: "service_handyman",
    slug: "handyman-service",
    displayName: "Handyman service",
    content: {
      eyebrow: "HANDYMAN SERVICES",
      title: "Reliable Help for the Small Jobs Around Your Home.",
      description:
        "From minor repairs and installations to everyday fixes, we help keep your home safe, functional, and well maintained.",
      heroImage: image(mediaIds.tools, "Handyman tools ready for household repairs"),
      heroPosition: "center 58%",
      servicesEyebrow: "WHAT WE CAN HELP WITH",
      servicesTitle: "Handyman services may include.",
      services: [
        { title: "Mounting & Shelving", body: "Secure installation for TVs, artwork, mirrors, shelving, and storage.", icon: "panel" },
        { title: "Drywall & Paint Repairs", body: "Patching holes, repairing wall damage, and completing clean paint touch-ups.", icon: "paint" },
        { title: "Furniture Assembly", body: "Beds, tables, cabinets, shelves, and other furniture assembled carefully.", icon: "armchair" },
        { title: "Fixtures, Doors & Hardware", body: "Install or adjust lights, faucets, handles, locks, hinges, and cabinet hardware.", icon: "wrench" }
      ],
      highlightTitle: "Simple, convenient service.",
      highlightBody: "Share what needs attention, add a few photos if possible, and we’ll provide a clear next step.",
      storyEyebrow: "WHY CHOOSE US",
      storyTitle: "Practical Help You Can Count On.",
      storyBody:
        "We handle the small jobs that make a big difference in daily life, with reliable service and respect for your home and time.",
      storyImage: image(mediaIds.tools, "Handyman tools arranged on a kitchen counter"),
      benefits: [
        { title: "Experienced & Reliable", body: "Practical help from skilled, dependable professionals.", icon: "hard-hat" },
        { title: "Attention to Detail", body: "Quality workmanship for the little things that matter.", icon: "search" },
        { title: "Clear Pricing", body: "Honest recommendations and a clear scope before work starts.", icon: "badge-dollar" },
        { title: "Respectful Service", body: "Care for your home, schedule, and everyday routine.", icon: "shield" }
      ],
      galleryEyebrow: "COMMON HANDYMAN SERVICES",
      galleryTitle: "The small jobs, handled.",
      gallery: [
        { title: "TV Mounting", body: "Secure placement and tidy cable planning.", icon: "panel", image: image(mediaIds.living, "Television mounted in a living room") },
        { title: "Shelving Installation", body: "Functional storage installed with care.", icon: "panel", image: image(mediaIds.office, "Wall shelving in a bright room") },
        { title: "Door & Hardware Repair", body: "Adjustments, handles, locks, and hinges.", icon: "door", image: image(mediaIds.furniture, "Interior door and household hardware") },
        { title: "Caulking & Sealing", body: "Clean, durable seals for kitchens and bathrooms.", icon: "droplets", image: image(mediaIds.bathroom, "Bathroom fixtures and sealed surfaces") }
      ],
      ctaTitle: "Have a List of Small Jobs?",
      ctaBody: "Let us take care of them. Request handyman service today."
    }
  },
  {
    sectionKey: "service_maintenance",
    slug: "property-maintenance",
    displayName: "Property maintenance",
    content: {
      eyebrow: "PROPERTY MAINTENANCE",
      title: "Ongoing Care to Keep Your Property in Great Condition.",
      description:
        "Regular maintenance helps prevent small issues from becoming larger problems and protects the long-term value of your property.",
      heroImage: image(mediaIds.garden, "Well-maintained home and landscaped garden"),
      heroPosition: "center 62%",
      servicesEyebrow: "MAINTENANCE SERVICES MAY INCLUDE",
      servicesTitle: "Practical care for every part of your property.",
      services: [
        { title: "Cleaning & Exterior Care", body: "Interior cleaning plus pressure washing for paths, decks, siding, and exterior surfaces.", icon: "sparkles" },
        { title: "Lawn & Seasonal Upkeep", body: "Mowing, pruning, leaf and gutter clearing, snow preparation, and seasonal clean-up.", icon: "flower" },
        { title: "Preventive Property Checks", body: "Routine checks for leaks, heating, ventilation, doors, drainage, and weather-related risks.", icon: "clipboard" },
        { title: "Minor Repairs & Coordination", body: "Resolve small issues early and coordinate qualified trades when specialized work is needed.", icon: "wrench" }
      ],
      highlightTitle: "One-time or ongoing care.",
      highlightBody: "Tell us what your property needs and we’ll recommend the right service plan.",
      storyEyebrow: "WHY CHOOSE US",
      storyTitle: "Prevent Problems. Save Time. Protect Your Investment.",
      storyBody:
        "A well-maintained property is safer, more comfortable, and retains its value longer. Reliable support gives you peace of mind year-round.",
      storyImage: image(mediaIds.house, "Well-maintained modern home and garden"),
      benefits: [
        { title: "Reliable & Punctual", body: "We arrive when promised and get the job done right.", icon: "clock" },
        { title: "Experienced Team", body: "Skilled professionals who take pride in every detail.", icon: "hard-hat" },
        { title: "Transparent Service", body: "Clear communication and honest recommendations.", icon: "message" },
        { title: "Flexible Plans", body: "One-time or ongoing service that fits your needs.", icon: "calendar" }
      ],
      galleryEyebrow: "SEASONAL MAINTENANCE",
      galleryTitle: "Year-round care for every season.",
      gallery: [
        { title: "Spring", body: "Garden clean-up, gutter cleaning, lawn care, and exterior washing.", icon: "flower", image: image(mediaIds.garden, "Garden in spring") },
        { title: "Summer", body: "Lawn mowing, hedge trimming, weeding, and irrigation checks.", icon: "leaf", image: image(mediaIds.house, "Landscaped home in summer") },
        { title: "Fall", body: "Leaf removal, gutter clearing, garden preparation, and exterior checks.", icon: "leaf", image: image(mediaIds.construction, "Exterior property care in fall") },
        { title: "Winter", body: "Snow removal, ice management, property checks, and weather prep.", icon: "snowflake", image: image(mediaIds.rental, "Home prepared for winter") }
      ],
      ctaTitle: "Keep Your Property in Top Shape.",
      ctaBody: "Let us handle the maintenance so you can enjoy peace of mind."
    }
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
    displayName: "Rental management",
    content: {
      eyebrow: "RENTAL MANAGEMENT",
      title: "Hassle-Free Management. Happy Tenants.",
      description:
        "Professional rental management that protects your property, maximizes your investment, and gives you peace of mind.",
      heroImage: image(mediaIds.rental, "Professionally managed modern rental home"),
      heroPosition: "center 56%",
      servicesEyebrow: "WHAT WE HANDLE",
      servicesTitle: "Comprehensive rental management services.",
      services: [
        { title: "Tenant Screening & Leasing", body: "Screen applications and references, prepare agreements, and manage renewals.", icon: "users" },
        { title: "Rent Collection & Reporting", body: "Coordinate rent payments and provide clear income, expense, and account reporting.", icon: "badge-dollar" },
        { title: "Inspections & Maintenance", body: "Document move-in, move-out, and routine condition checks while coordinating repairs.", icon: "wrench" },
        { title: "Tenant Communication & Compliance", body: "Handle tenant requests, notices, records, and day-to-day communication under BC tenancy rules.", icon: "message" }
      ],
      highlightTitle: "Protect your investment.",
      highlightBody: "We treat your property as if it were our own, with proactive care and attention to every detail.",
      storyEyebrow: "WHY CHOOSE US",
      storyTitle: "Local Expertise. Reliable Results.",
      storyBody:
        "We combine local market knowledge with professional management practices to maximize rental income and minimize stress.",
      storyImage: image(mediaIds.city, "Greater Vancouver skyline and mountains"),
      benefits: [
        { title: "Maximize Returns", body: "Thoughtful pricing, leasing, and ongoing oversight.", icon: "badge-dollar" },
        { title: "Protect Your Property", body: "Proactive inspections, maintenance, and issue resolution.", icon: "shield" },
        { title: "Reduce Vacancy", body: "Strong tenant screening and responsive leasing support.", icon: "users" },
        { title: "Peace of Mind", body: "Clear reporting and dependable day-to-day management.", icon: "check" }
      ],
      galleryEyebrow: "WHAT’S INCLUDED",
      galleryTitle: "Everything you need, all in one place.",
      gallery: [
        { title: "Marketing & Leasing", body: "Professional marketing, showings, and tenant placement.", icon: "users", image: image(mediaIds.office, "Rental marketing and leasing consultation") },
        { title: "Rent & Financial Management", body: "Collection, follow-up, and financial reporting.", icon: "file-chart", image: image(mediaIds.paperwork, "Rental financial reports and records") },
        { title: "Repairs & Maintenance", body: "Coordination and supervision of maintenance work.", icon: "wrench", image: image(mediaIds.tools, "Tools for rental property maintenance") },
        { title: "Legal & Compliance", body: "Support aligned with BC tenancy requirements.", icon: "shield", image: image(mediaIds.paperwork, "Rental agreements and compliance documents") }
      ],
      ctaTitle: "Ready for Worry-Free Rental Management?",
      ctaBody: "Enjoy the benefits of your investment without the day-to-day stress."
    }
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
