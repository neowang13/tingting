import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Bath,
  BedDouble,
  Building2,
  CalendarDays,
  HardHat,
  House,
  KeyRound,
  Mail,
  PawPrint,
  Phone,
  Ruler,
  Wrench
} from "lucide-react";
import { ContactForm } from "@/components/public/contact-form";
import { GoogleReviewCard } from "@/components/public/google-review-card";
import { ServiceDetails } from "@/components/public/service-details";
import { SiteFooter, SiteHeader } from "@/components/public/site-chrome";
import { resolveSeededPublicMedia } from "@/features/content/public-media";
import type { PublicHomepageData } from "@/features/content/public-homepage";
import { googleReviewDemoFeed, type GoogleReviewFeed } from "@/features/google-reviews";
import { shouldServePublicImageDirectly } from "@/lib/public-image-url";

const serviceIcons = {
  rental_management: KeyRound,
  trade_services: HardHat,
  property_care: Wrench,
  strata: Building2
} as const;

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(`${value}T00:00:00Z`));
}

export function SiteHome({
  sections,
  rentals,
  mediaUrls,
  googleReviews
}: PublicHomepageData & { googleReviews?: GoogleReviewFeed }) {
  const { header, hero, property_services: services } = sections;
  const { featured_rentals: featured, about, contact, footer } = sections;
  const heroImage = mediaUrls[hero.background.mediaAssetId] ?? resolveSeededPublicMedia(hero.background.mediaAssetId);
  const portraitImage = mediaUrls[about.portrait.mediaAssetId] ?? resolveSeededPublicMedia(about.portrait.mediaAssetId);
  const googleBusinessUrl = process.env.NEXT_PUBLIC_GOOGLE_BUSINESS_URL
    ?? "https://www.google.com/search?q=Ting+Ting+Xu+Personal+Real+Estate+Corporation+Vancouver";
  const googleReviewUrl = process.env.NEXT_PUBLIC_GOOGLE_REVIEW_URL ?? googleBusinessUrl;
  const reviewFeed = googleReviews ?? googleReviewDemoFeed;
  return (
    <>
      <SiteHeader header={header} />

      <main>
        <section className="hero" aria-labelledby="hero-heading">
          {heroImage ? (
            <Image
              className="hero-image"
              src={heroImage}
              alt={hero.background.alt}
              fill
              priority
              unoptimized={shouldServePublicImageDirectly(heroImage)}
              sizes="100vw"
            />
          ) : (
            <div className="hero-media-placeholder" role="img" aria-label={hero.background.alt} />
          )}
          <div className="hero-scrim" aria-hidden />
          <div className="container hero-layout">
            <div className="hero-copy">
              <div className="eyebrow">{hero.eyebrow}</div>
              <h1 id="hero-heading">{hero.heading}</h1>
              <p>{hero.body}</p>
              <div className="hero-brokerage">
                <Image
                  src="/images/remax-city-realty-logo-white-v2.png"
                  alt="RE/MAX City Realty"
                  width={1164}
                  height={1000}
                  sizes="132px"
                  unoptimized
                />
              </div>
              <Link className="button hero-cta" href={hero.primaryCta.href}>
                {hero.primaryCta.label}
                <ArrowRight size={18} aria-hidden />
              </Link>
            </div>
            <GoogleReviewCard
              businessUrl={googleBusinessUrl}
              reviewUrl={googleReviewUrl}
              reviews={reviewFeed.reviews}
              rating={reviewFeed.rating}
              reviewCount={reviewFeed.reviewCount}
            />
          </div>
        </section>

        <section className="section services-section anchor-section" id="services">
          <div className="container">
            <div className="section-heading">
              <div className="eyebrow">{services.eyebrow}</div>
              <h2>{services.heading}</h2>
              <p>{services.body}</p>
            </div>
            <div className="service-grid">
              {services.services.map((service) => {
                const Icon = serviceIcons[service.key];
                return (
                  <article className="service-card" key={service.key}>
                    <div className="icon-badge"><Icon size={28} strokeWidth={1.8} aria-hidden /></div>
                    <h3>{service.title}</h3>
                    <p>{service.summary}</p>
                    <ServiceDetails service={service} />
                  </article>
                );
              })}
            </div>
            <div className="section-action">
              <Link className="button" href={services.primaryCta.href}>
                {services.primaryCta.label}
              </Link>
            </div>
          </div>
        </section>

        <section className="section rentals-section anchor-section" id="rentals">
          <div className="container">
            <div className="section-topline">
              <div>
                {featured.eyebrow && <div className="eyebrow">{featured.eyebrow}</div>}
                <h2>{featured.heading}</h2>
                {featured.intro && <p>{featured.intro}</p>}
              </div>
              <Link className="button secondary compact-button" href={featured.viewAllCta.href}>
                {featured.viewAllCta.label}
                <ArrowRight size={16} aria-hidden />
              </Link>
            </div>
            {rentals.length ? (
              <div className="rental-grid">
                {rentals.map((rental) => (
                  <article className="rental-card" key={rental.id}>
                    <div className="rental-media">
                      {rental.coverImageUrl ? (
                        <Image
                          src={rental.coverImageUrl}
                          alt={`${rental.title} in ${rental.city}`}
                          fill
                          unoptimized={shouldServePublicImageDirectly(rental.coverImageUrl)}
                          sizes="(max-width: 700px) 100vw, (max-width: 1050px) 50vw, 33vw"
                        />
                      ) : (
                        <div className="rental-image-placeholder" role="img" aria-label={rental.title}>
                          <House aria-hidden />
                        </div>
                      )}
                    </div>
                    <div className="rental-card-body">
                      <strong className="rent-price">
                        ${(rental.monthlyRentCents / 100).toLocaleString("en-CA")} <span>/ month</span>
                      </strong>
                      <h3>{rental.title}</h3>
                      <p className="rental-address">
                        {rental.addressLine}<br />
                        {[rental.neighbourhood, rental.city].filter(Boolean).join(", ")}
                      </p>
                      <dl className="rental-facts">
                        <div><dt><BedDouble aria-hidden /> Bedrooms</dt><dd>{formatNumber(rental.bedrooms)}</dd></div>
                        <div><dt><Bath aria-hidden /> Bathrooms</dt><dd>{formatNumber(rental.bathrooms)}</dd></div>
                        {rental.squareFeet && (
                          <div><dt><Ruler aria-hidden /> Size</dt><dd>{rental.squareFeet.toLocaleString()} sq. ft.</dd></div>
                        )}
                        {rental.availableOn && (
                          <div><dt><CalendarDays aria-hidden /> Available</dt><dd>{formatDate(rental.availableOn)}</dd></div>
                        )}
                        {rental.petPolicy && (
                          <div><dt><PawPrint aria-hidden /> Pets</dt><dd>{rental.petPolicy}</dd></div>
                        )}
                      </dl>
                      <Link className="text-link" href={`/rentals/${rental.slug}`}>
                        View rental
                        <ArrowRight size={16} aria-hidden />
                      </Link>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <h3>{featured.emptyState.heading}</h3>
                <p>{featured.emptyState.body}</p>
                <Link className="button" href={featured.emptyState.cta.href}>
                  {featured.emptyState.cta.label}
                </Link>
              </div>
            )}
          </div>
        </section>

        <section className="section about-section anchor-section" id="about">
          <div className="container about-panel">
            <div className="about-portrait">
              {portraitImage ? (
                <Image
                  src={portraitImage}
                  alt={about.portrait.alt}
                  fill
                  unoptimized={portraitImage.startsWith("/") || shouldServePublicImageDirectly(portraitImage)}
                  sizes="(max-width: 700px) 100vw, 38vw"
                />
              ) : (
                <div className="portrait-placeholder" role="img" aria-label={about.portrait.alt}>
                  <span>TX</span>
                  <small>Approved portrait pending</small>
                </div>
              )}
            </div>
            <div className="about-copy">
              <div className="eyebrow">{about.eyebrow}</div>
              <h2>{about.heading}</h2>
              {about.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
              {about.cta && (
                <Link className="text-link" href="/about">
                  Learn more about Ting Ting
                  <ArrowRight size={16} aria-hidden />
                </Link>
              )}
            </div>
          </div>
        </section>

        <section className="section contact-section anchor-section" id="contact">
          <div className="container contact-panel">
            <div className="contact-copy">
              <div className="eyebrow">CONTACT</div>
              <h2>{contact.heading}</h2>
              <p>{contact.body}</p>
              <a className="contact-method" href={`tel:${contact.publicPhone.replace(/[^\d+]/g, "")}`}>
                <Phone size={19} aria-hidden />
                {contact.publicPhone}
              </a>
              <a className="contact-method" href={`mailto:${contact.publicEmail}`}>
                <Mail size={19} aria-hidden />
                {contact.publicEmail}
              </a>
            </div>
            <ContactForm
              idPrefix="homepage-contact"
              labels={contact.fieldLabels}
              options={contact.preferredContactOptions}
              submitLabel={contact.submitLabel}
              successMessage={contact.successMessage}
              errorMessage={contact.errorMessage}
              publicEmail={contact.publicEmail}
              publicPhone={contact.publicPhone}
            />
          </div>
        </section>
      </main>

      <SiteFooter footer={footer} />
    </>
  );
}
