import Image from "next/image";
import Link from "next/link";
import { ArrowRight, House, Phone } from "lucide-react";
import { ContactForm } from "@/components/public/contact-form";
import { GoogleReviewCard } from "@/components/public/google-review-card";
import { SiteFooter, SiteHeader } from "@/components/public/site-chrome";
import type { PublicHomepageData } from "@/features/content/public-homepage";
import { googleReviewEmptyFeed, type GoogleReviewFeed } from "@/features/google-reviews";
import { shouldServePublicImageDirectly } from "@/lib/public-image-url";

const servicePresentation = {
  rental_management: {
    number: "01",
    title: "Rental Management",
    summary: "Leasing, rent collection, inspections and maintenance.",
    href: "/services/rental-management"
  },
  trade_services: {
    number: "02",
    title: "Trade Services",
    summary: "Repairs, renovations and trusted trade coordination.",
    href: "/services/trade-services"
  },
  property_care: {
    number: "03",
    title: "Property Care",
    summary: "Cleaning, upkeep and everyday property maintenance.",
    href: "/services/property-care"
  },
  strata: {
    number: "04",
    title: "Strata Services",
    summary: "Strata maintenance, access and vendor coordination.",
    href: "/services/strata-service"
  }
} as const;

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function availabilityLabel(value: string | null | undefined) {
  if (!value || value <= new Date().toISOString().slice(0, 10)) return "Available now";
  return `Available ${new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  }).format(new Date(`${value}T00:00:00Z`))}`;
}

export function SiteHome({
  sections,
  rentals,
  googleReviews
}: PublicHomepageData & { googleReviews?: GoogleReviewFeed }) {
  const { header, property_services: services, contact, footer } = sections;
  const reviewFeed = googleReviews ?? googleReviewEmptyFeed;
  const googleBusinessUrl = process.env.NEXT_PUBLIC_GOOGLE_BUSINESS_URL
    ?? "https://www.google.com/search?q=Ting+Ting+Xu+Personal+Real+Estate+Corporation+Vancouver";
  const googleReviewUrl = process.env.NEXT_PUBLIC_GOOGLE_REVIEW_URL ?? googleBusinessUrl;

  return (
    <div className="home-redesign">
      <SiteHeader header={header} variant="home" />

      <main>
        <section className="home-hero" aria-labelledby="hero-heading">
          <Image
            className="home-hero-image"
            src="/images/silverkey-home-hero-2026.webp"
            alt="The four-person Silverkey real estate team"
            fill
            priority
            unoptimized
            sizes="100vw"
          />
          <div className="home-hero-scrim" aria-hidden />
          <div className="home-shell home-hero-copy">
            <div className="home-eyebrow">Greater Vancouver, made simpler</div>
            <h1 id="hero-heading">Property, managed like a modern service.</h1>
            <p>Find a home, book a viewing, apply online, or hand us the day-to-day work. Silverkey brings every step into one clear experience.</p>
            <div className="home-hero-credentials" aria-label="Professional credentials">
              <span>Tingting Xu Personal Real Estate Corporation.</span>
              <i aria-hidden />
              <span>RE/MAX City Realty · Brokerage</span>
              <i aria-hidden />
              <span>Greater Vancouver</span>
            </div>
            <div className="home-hero-mobile-brokerage">
              <Image
                src="/images/remax-city-realty-logo-white-v2.png"
                alt="RE/MAX City Realty"
                width={1164}
                height={1000}
                unoptimized
              />
              <span>RE/MAX City Realty<br />Brokerage · Greater Vancouver</span>
            </div>
          </div>
        </section>

        <section className="home-rentals-section anchor-section" id="rentals" aria-labelledby="rentals-heading">
          <div className="home-wide-shell">
            <div className="home-section-heading home-section-heading-left">
              <div className="home-eyebrow">Featured rentals</div>
              <h2 id="rentals-heading">Don’t browse a brochure. Start your search.</h2>
            </div>

            {rentals.length ? (
              <div className="home-rental-grid">
                {rentals.map((rental) => (
                  <article className="home-rental-card" key={rental.id}>
                    <div className="home-rental-media">
                      {rental.coverImageUrl ? (
                        <Image
                          src={rental.coverImageUrl}
                          alt={`${rental.title} in ${rental.city}`}
                          fill
                          unoptimized={shouldServePublicImageDirectly(rental.coverImageUrl)}
                          sizes="(max-width: 760px) 132px, (max-width: 1180px) 33vw, 20vw"
                        />
                      ) : (
                        <div className="home-rental-placeholder" role="img" aria-label={rental.title}>
                          <House aria-hidden />
                          <span>Cover photo</span>
                        </div>
                      )}
                      <span className="home-rental-status">{availabilityLabel(rental.availableOn)}</span>
                    </div>
                    <div className="home-rental-body">
                      <strong className="home-rental-price">
                        ${(rental.monthlyRentCents / 100).toLocaleString("en-CA")}
                        <span> / month</span>
                      </strong>
                      <h3>{rental.title}</h3>
                      <p>{[rental.neighbourhood, rental.city].filter(Boolean).join(", ")}</p>
                      <div className="home-rental-facts">
                        <span>{formatNumber(rental.bedrooms)} bed</span>
                        <span>{formatNumber(rental.bathrooms)} bath</span>
                        {rental.squareFeet && <span>{rental.squareFeet.toLocaleString("en-CA")} sq ft</span>}
                      </div>
                      <Link className="home-rental-link" href={`/rentals/${rental.slug}`}>View home</Link>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="home-empty-state">
                <h3>New rentals are coming soon</h3>
                <p>Contact us and we will help you find the right home.</p>
              </div>
            )}

            <Link className="home-outline-button" href="/rentals">
              View all homes <ArrowRight aria-hidden />
            </Link>
          </div>
        </section>

        <section className="home-contact-section anchor-section" id="contact" aria-labelledby="contact-heading">
          <div className="home-shell home-contact-grid">
            <div className="home-contact-copy">
              <h2 id="contact-heading">Start with what you need.</h2>
              <p>Send us the task and we route it to the right person. For urgent repairs, please call.</p>
              <dl>
                <div><dt>Phone</dt><dd><a href={`tel:${contact.publicPhone.replace(/[^\d+]/g, "")}`}>{contact.publicPhone}</a></dd></div>
                <div><dt>Email</dt><dd><a href={`mailto:${contact.publicEmail}`}>{contact.publicEmail}</a></dd></div>
                <div><dt>Hours</dt><dd>Mon–Fri, 9am–6pm</dd></div>
              </dl>
            </div>
            <div>
              <ContactForm
                appearance="home-dark"
                idPrefix="homepage-contact"
                labels={contact.fieldLabels}
                options={contact.preferredContactOptions}
                submitLabel={contact.submitLabel}
                successMessage={contact.successMessage}
                errorMessage={contact.errorMessage}
                publicEmail={contact.publicEmail}
                publicPhone={contact.publicPhone}
              />
              <p className="home-contact-privacy">Please don’t send ID or application documents here — those belong in your client portal.</p>
            </div>
          </div>
        </section>

        <section className="home-services-section anchor-section" id="services" aria-labelledby="services-heading">
          <div className="home-wide-shell">
            <div className="home-section-heading">
              <div className="home-eyebrow">Property services</div>
              <h2 id="services-heading">Property support without the loose ends.</h2>
              <p>Four services with written boundaries: what we do, what needs your approval, and what goes to a licensed professional.</p>
            </div>
            <div className="home-service-grid">
              {services.services.map((service) => {
                const presentation = servicePresentation[service.key];
                return (
                  <article className="home-service-card" key={service.key}>
                    <span className="home-service-number">{presentation.number}</span>
                    <h3>{presentation.title}</h3>
                    <p>{presentation.summary}</p>
                    <Link href={presentation.href}>Learn more <ArrowRight aria-hidden /></Link>
                  </article>
                );
              })}
            </div>
            <Link className="home-primary-button" href="#contact">Request a service</Link>
          </div>
        </section>

        <GoogleReviewCard
          businessUrl={googleBusinessUrl}
          reviewUrl={googleReviewUrl}
          reviews={reviewFeed.reviews}
          rating={reviewFeed.rating}
          reviewCount={reviewFeed.reviewCount}
        />
      </main>

      <SiteFooter footer={footer} />

      <div className="home-mobile-actionbar">
        <Link href="/rentals">Find a home</Link>
        <a href={`tel:${contact.publicPhone.replace(/[^\d+]/g, "")}`} aria-label={`Call ${contact.publicPhone}`}>
          <Phone aria-hidden />
        </a>
      </div>
    </div>
  );
}
