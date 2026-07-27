import Image from "next/image";
import {
  Armchair,
  BadgeDollarSign,
  Bath,
  Building2,
  CalendarDays,
  CircleCheck,
  ClipboardCheck,
  Clock,
  DoorOpen,
  Drill,
  Droplets,
  FileChartColumn,
  Flower2,
  Hammer,
  Handshake,
  HardHat,
  House,
  KeyRound,
  Leaf,
  Lightbulb,
  Mail,
  MessageCircle,
  PaintRoller,
  PanelTop,
  Phone,
  Plug,
  Search,
  ShieldCheck,
  Snowflake,
  Sparkles,
  UsersRound,
  Wrench,
  type LucideIcon
} from "lucide-react";
import { ContactModalProvider, ContactTrigger } from "@/components/public/contact-modal";
import { SiteFooter, SiteHeader } from "@/components/public/site-chrome";
import type { PublicHomepageData } from "@/features/content/public-homepage";
import { resolveSeededPublicMedia } from "@/features/content/public-media";
import type {
  ServiceIconKey,
  ServiceMediaReference,
  ServicePageContent
} from "@/features/content/service-pages";
import type { ServicePageSectionKey } from "@/lib/contracts";

const serviceIcons: Record<ServiceIconKey, LucideIcon> = {
  armchair: Armchair,
  "badge-dollar": BadgeDollarSign,
  bath: Bath,
  building: Building2,
  calendar: CalendarDays,
  check: CircleCheck,
  clipboard: ClipboardCheck,
  clock: Clock,
  door: DoorOpen,
  drill: Drill,
  droplets: Droplets,
  "file-chart": FileChartColumn,
  flower: Flower2,
  hammer: Hammer,
  handshake: Handshake,
  "hard-hat": HardHat,
  house: House,
  key: KeyRound,
  leaf: Leaf,
  lightbulb: Lightbulb,
  mail: Mail,
  message: MessageCircle,
  paint: PaintRoller,
  panel: PanelTop,
  phone: Phone,
  plug: Plug,
  search: Search,
  shield: ShieldCheck,
  snowflake: Snowflake,
  sparkles: Sparkles,
  users: UsersRound,
  wrench: Wrench
};

function IconBadge({ icon, className = "" }: { icon: ServiceIconKey; className?: string }) {
  const Icon = serviceIcons[icon];
  return (
    <span className={`service-page-icon ${className}`.trim()} aria-hidden>
      <Icon size={27} strokeWidth={1.65} />
    </span>
  );
}

function resolveImage(
  reference: ServiceMediaReference,
  mediaUrls: Record<string, string | null>
) {
  return mediaUrls[reference.mediaAssetId] ?? resolveSeededPublicMedia(reference.mediaAssetId);
}

function ServiceGrid({
  page,
  mediaUrls
}: {
  page: ServicePageContent;
  mediaUrls: Record<string, string | null>;
}) {
  const hasImages = page.services.some((service) => service.image);
  return (
    <section className="service-page-section service-page-services" aria-labelledby="service-list-heading">
      <div className="container">
        <div className="service-page-heading">
          <div className="eyebrow">{page.servicesEyebrow}</div>
          <h2 id="service-list-heading">{page.servicesTitle}</h2>
        </div>
        <div className={hasImages ? "service-offering-grid image-grid" : "service-offering-grid"}>
          {page.services.map((service) => (
            <article className={service.image ? "service-offering image-card" : "service-offering"} key={service.title}>
              {service.image && resolveImage(service.image, mediaUrls) ? (
                <div className="service-offering-image">
                  <Image
                    src={resolveImage(service.image, mediaUrls)!}
                    alt={service.image.alt}
                    fill
                    sizes="(max-width: 700px) 100vw, 25vw"
                  />
                </div>
              ) : (
                <IconBadge icon={service.icon} />
              )}
              <div className="service-offering-copy">
                <h3>{service.title}</h3>
                <p>{service.body}</p>
                {service.image && (
                  <ContactTrigger className="service-inline-action" ariaLabel={`Contact us about ${service.title}`}>
                    Contact us <span aria-hidden>→</span>
                  </ContactTrigger>
                )}
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function StorySection({
  page,
  mediaUrls
}: {
  page: ServicePageContent;
  mediaUrls: Record<string, string | null>;
}) {
  const storyImage = resolveImage(page.storyImage, mediaUrls);
  return (
    <section className="service-page-section service-story" aria-labelledby="service-story-heading">
      <div className="container service-story-panel">
        <div className="service-story-image">
          {storyImage && (
            <Image
              src={storyImage}
              alt={page.storyImage.alt}
              fill
              sizes="(max-width: 760px) 100vw, 46vw"
            />
          )}
        </div>
        <div className="service-story-copy">
          <div className="eyebrow">{page.storyEyebrow}</div>
          <h2 id="service-story-heading">{page.storyTitle}</h2>
          <p>{page.storyBody}</p>
          <div className="service-benefit-grid">
            {page.benefits.map((benefit) => (
              <article key={benefit.title}>
                <IconBadge icon={benefit.icon} />
                <div>
                  <h3>{benefit.title}</h3>
                  <p>{benefit.body}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function GallerySection({
  page,
  mediaUrls
}: {
  page: ServicePageContent;
  mediaUrls: Record<string, string | null>;
}) {
  return (
    <section className="service-page-section service-gallery-section" aria-labelledby="gallery-heading">
      <div className="container service-gallery-panel">
        <div className="service-page-heading">
          <div className="eyebrow">{page.galleryEyebrow}</div>
          <h2 id="gallery-heading">{page.galleryTitle}</h2>
        </div>
        <div className={`service-gallery gallery-count-${page.gallery.length}`}>
          {page.gallery.map((item) => (
            <article key={item.title}>
              {item.image && resolveImage(item.image, mediaUrls) && (
                <div className="service-gallery-image">
                  <Image
                    src={resolveImage(item.image, mediaUrls)!}
                    alt={item.image.alt}
                    fill
                    sizes="(max-width: 700px) 100vw, 25vw"
                  />
                </div>
              )}
              <div>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </div>
            </article>
          ))}
        </div>
        <ContactTrigger className="button secondary service-gallery-cta">Request service</ContactTrigger>
      </div>
    </section>
  );
}

export function ServiceLandingPage({
  page,
  sectionKey,
  sections,
  mediaUrls
}: {
  page: ServicePageContent;
  sectionKey: ServicePageSectionKey;
  sections: PublicHomepageData["sections"];
  mediaUrls: Record<string, string | null>;
}) {
  const heroImage = resolveImage(page.heroImage, mediaUrls);
  const storyFirst = sectionKey === "service_renovation";
  return (
    <ContactModalProvider contact={sections.contact}>
      <SiteHeader header={sections.header} />
      <main className="service-page">
        <section className="service-page-hero" aria-labelledby="service-page-title">
          {heroImage && (
            <Image
              className="service-page-hero-image"
              src={heroImage}
              alt={page.heroImage.alt}
              fill
              priority
              sizes="100vw"
              style={{ objectPosition: page.heroPosition }}
            />
          )}
          <div className="service-page-hero-scrim" aria-hidden />
          <div className="container service-page-hero-copy">
            <div className="eyebrow">{page.eyebrow}</div>
            <h1 id="service-page-title">{page.title}</h1>
            <p>{page.description}</p>
            <div className="service-hero-actions">
              <ContactTrigger className="button">Contact us</ContactTrigger>
              <a className="button secondary service-call-button" href="tel:+16048726896">
                <Phone size={17} aria-hidden />
                Call 604-872-6896
              </a>
            </div>
          </div>
        </section>

        {storyFirst && <StorySection page={page} mediaUrls={mediaUrls} />}
        <ServiceGrid page={page} mediaUrls={mediaUrls} />

        <section className="service-highlight">
          <div className="container service-highlight-inner">
            <IconBadge icon="calendar" />
            <div>
              <h2>{page.highlightTitle}</h2>
              <p>{page.highlightBody}</p>
            </div>
            <ContactTrigger className="button">Request service</ContactTrigger>
          </div>
        </section>

        {!storyFirst && <StorySection page={page} mediaUrls={mediaUrls} />}
        <GallerySection page={page} mediaUrls={mediaUrls} />

        <section className="service-final-cta" aria-labelledby="service-final-heading">
          <div className="container service-final-inner">
            <IconBadge icon="house" />
            <div>
              <h2 id="service-final-heading">{page.ctaTitle}</h2>
              <p>{page.ctaBody}</p>
            </div>
            <div className="service-final-actions">
              <ContactTrigger className="button">Contact us</ContactTrigger>
              <a className="button secondary" href="tel:+16048726896">
                <Phone size={17} aria-hidden />
                Call 604-872-6896
              </a>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter footer={sections.footer} />
    </ContactModalProvider>
  );
}
