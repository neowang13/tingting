import Link from "next/link";
import { Bath, BedDouble, CalendarDays, Mail, PawPrint, Phone, Ruler } from "lucide-react";
import { ContactModalProvider, ContactTrigger } from "@/components/public/contact-modal";
import { RentalCard } from "@/components/public/rental-card";
import { RentalGallery } from "@/components/public/rental-gallery";
import { SiteFooter, SiteHeader } from "@/components/public/site-chrome";
import {
  formatRentalArea,
  formatRentalAvailability,
  formatRentalCount,
  formatRentalLocation,
  formatRentalPrice,
  type PublicRentalDetailData
} from "@/features/content/public-rental-detail";
import { amenityGroups, utilityOptions } from "@/features/rentals/v2";

export function RentalDetailPage({
  rental,
  similarRentals,
  sections
}: PublicRentalDetailData) {
  const images = rental.images.length
    ? rental.images
    : rental.coverImageUrl
      ? [{
          mediaAssetId: `cover-${rental.id}`,
          url: rental.coverImageUrl,
          alt: `${rental.title} in ${rental.city}`,
          sortOrder: 0,
          isCover: true
        }]
      : [];
  const paragraphs = rental.description
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const amenityLabels = new Map(
    amenityGroups.flatMap((group) => group.items.map(([code, label]) => [code, label] as const))
  );
  const utilityLabels = new Map(utilityOptions);
  const contactPhone = rental.contact?.mode === "custom" && rental.contact.phone
    ? rental.contact.phone
    : sections.contact.publicPhone;
  const contactEmail = rental.contact?.mode === "custom" && rental.contact.email
    ? rental.contact.email
    : sections.contact.publicEmail;

  return (
    <ContactModalProvider contact={sections.contact}>
      <div className="rental-detail-page">
        <div className="rental-detail-hero">
          <SiteHeader header={sections.header} />
          <div className="container rental-detail-hero-inner">
            <nav className="rental-breadcrumb" aria-label="Breadcrumb">
              <Link href="/rentals">← Back to Rentals</Link>
            </nav>
            <div className="rental-detail-hero-grid">
              <RentalGallery title={rental.title} city={rental.city} images={images} />
              <aside className="rental-summary-card">
                <span className="rental-status-badge">For rent</span>
                <h1>{rental.title}</h1>
                <p className="rent-price">{formatRentalPrice(rental.monthlyRentCents)} <span>/ month</span></p>
                <p className="rental-summary-address">{rental.addressLine}</p>
                <p>{formatRentalLocation(rental.neighbourhood, rental.city)}</p>
                <dl className="rental-summary-facts">
                  <div><dt><BedDouble aria-hidden /> Bedrooms</dt><dd>{formatRentalCount(rental.bedrooms)}</dd></div>
                  <div><dt><Bath aria-hidden /> Bathrooms</dt><dd>{formatRentalCount(rental.bathrooms)}</dd></div>
                  {rental.squareFeet !== null && (
                    <div><dt><Ruler aria-hidden /> Size</dt><dd>{formatRentalArea(rental.squareFeet)}</dd></div>
                  )}
                </dl>
                <div className="rental-viewing-actions">
                  <ContactTrigger className="button rental-viewing-cta">Book a viewing</ContactTrigger>
                  <div>
                    {contactPhone && (
                      <a href={`tel:${contactPhone.replace(/[^\d+]/g, "")}`}>
                        <Phone aria-hidden /> {contactPhone}
                      </a>
                    )}
                    {contactEmail && (
                      <a href={`mailto:${contactEmail}`}>
                        <Mail aria-hidden /> {contactEmail}
                      </a>
                    )}
                  </div>
                </div>
              </aside>
            </div>
          </div>
        </div>

        <main className="rental-detail-content">
          <div className="container rental-detail-content-grid">
            <section className="rental-about" aria-labelledby="rental-about-heading">
              <div className="eyebrow">THE HOME</div>
              <h2 id="rental-about-heading">About this rental</h2>
              {paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            </section>
            <section className="rental-details-card" aria-labelledby="rental-details-heading">
              <h2 id="rental-details-heading">Listing details</h2>
              <dl>
                <div><dt><BedDouble aria-hidden /> Bedrooms</dt><dd>{formatRentalCount(rental.bedrooms)}</dd></div>
                <div><dt><Bath aria-hidden /> Bathrooms</dt><dd>{formatRentalCount(rental.bathrooms)}</dd></div>
                {rental.squareFeet !== null && (
                  <div><dt><Ruler aria-hidden /> Square feet</dt><dd>{formatRentalArea(rental.squareFeet)}</dd></div>
                )}
                {rental.availableOn && (
                  <div><dt><CalendarDays aria-hidden /> Available</dt><dd>{formatRentalAvailability(rental.availableOn)}</dd></div>
                )}
                {rental.availabilityStatus && !rental.availableOn && (
                  <div><dt><CalendarDays aria-hidden /> Available</dt><dd>{availabilityLabel(rental.availabilityStatus)}</dd></div>
                )}
                {rental.property?.propertyType && (
                  <div><dt>Property type</dt><dd>{humanize(rental.property.propertyType)}</dd></div>
                )}
                {rental.denCount !== undefined && rental.denCount > 0 && (
                  <div><dt>Dens</dt><dd>{rental.denCount}</dd></div>
                )}
                {rental.furnishedStatus && (
                  <div><dt>Furnishing</dt><dd>{humanize(rental.furnishedStatus)}</dd></div>
                )}
                {rental.leaseType && (
                  <div><dt>Lease</dt><dd>{humanize(rental.leaseType)}{rental.minimumLeaseMonths ? ` · ${rental.minimumLeaseMonths} months minimum` : ""}</dd></div>
                )}
                {(rental.pets?.status || rental.petPolicy) && (
                  <div><dt><PawPrint aria-hidden /> Pet policy</dt><dd>{rental.pets?.status ? petLabel(rental) : rental.petPolicy}</dd></div>
                )}
                {rental.smokingPolicy && <div><dt>Smoking</dt><dd>{humanize(rental.smokingPolicy)}</dd></div>}
              </dl>
            </section>
          </div>

          {(rental.parking?.available || rental.storage?.available) && (
            <section className="section rental-structured-section" aria-labelledby="parking-storage-heading">
              <div className="container"><div className="eyebrow">PRACTICAL DETAILS</div><h2 id="parking-storage-heading">Parking and storage</h2>
                <div className="rental-feature-grid">
                  {rental.parking?.available && <article><h3>Parking</h3><p>{[
                    rental.parking.type ? humanize(rental.parking.type) : null,
                    rental.parking.stalls !== null ? `${rental.parking.stalls} stall${rental.parking.stalls === 1 ? "" : "s"}` : null,
                    rental.parking.included ? "included in rent" : null
                  ].filter(Boolean).join(" · ")}</p>{rental.parking.notes && <p>{rental.parking.notes}</p>}</article>}
                  {rental.storage?.available && <article><h3>Storage</h3><p>{[
                    rental.storage.lockers !== null ? `${rental.storage.lockers} locker${rental.storage.lockers === 1 ? "" : "s"}` : null,
                    rental.storage.included ? "included in rent" : null
                  ].filter(Boolean).join(" · ")}</p>{rental.storage.notes && <p>{rental.storage.notes}</p>}</article>}
                </div>
              </div>
            </section>
          )}

          {((rental.includedUtilityCodes?.length ?? 0) > 0 || (rental.amenityCodes?.length ?? 0) > 0) && (
            <section className="section rental-structured-section" aria-labelledby="features-heading">
              <div className="container"><div className="eyebrow">WHAT’S INCLUDED</div><h2 id="features-heading">Features and amenities</h2>
                <div className="rental-feature-grid">
                  {(rental.includedUtilityCodes?.length ?? 0) > 0 && <article><h3>Utilities included in rent</h3><ul>{rental.includedUtilityCodes?.map((code) => <li key={code}>{utilityLabels.get(code as never) ?? humanize(code)}</li>)}</ul>{rental.utilitiesNotes && <p>{rental.utilitiesNotes}</p>}</article>}
                  {(rental.amenityCodes?.length ?? 0) > 0 && <article><h3>Home and building features</h3><ul>{rental.amenityCodes?.map((code) => <li key={code}>{amenityLabels.get(code as never) ?? humanize(code)}</li>)}</ul>{rental.amenityNotes && <p>{rental.amenityNotes}</p>}</article>}
                </div>
              </div>
            </section>
          )}

          {(rental.fees?.length ?? 0) > 0 && (
            <section className="section rental-structured-section" aria-labelledby="fees-heading">
              <div className="container"><div className="eyebrow">COSTS</div><h2 id="fees-heading">Fees and deposits</h2>
                <ul className="rental-fee-list">{rental.fees?.map((fee, index) => <li key={fee.id ?? `${fee.feeType}-${index}`}><strong>{fee.label ?? humanize(fee.feeType)}</strong><span>{formatRentalPrice(fee.amountCents)} · {fee.frequency === "monthly" ? "monthly" : "one time"}{fee.refundable ? " · refundable" : ""}</span></li>)}</ul>
              </div>
            </section>
          )}

          {similarRentals.length > 0 && (
            <section className="section rental-similar" aria-labelledby="similar-rentals-heading">
              <div className="container">
                <div className="section-topline">
                  <div>
                    <div className="eyebrow">MORE HOMES</div>
                    <h2 id="similar-rentals-heading">Similar rentals</h2>
                  </div>
                  <Link className="text-link" href="/rentals">View all rentals →</Link>
                </div>
                <div className="rental-grid rental-similar-grid">
                  {similarRentals.map((candidate) => (
                    <RentalCard rental={candidate} key={candidate.id} />
                  ))}
                </div>
              </div>
            </section>
          )}
        </main>
        <SiteFooter footer={sections.footer} />
      </div>
    </ContactModalProvider>
  );
}

function humanize(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function availabilityLabel(value: NonNullable<PublicRentalDetailData["rental"]["availabilityStatus"]>) {
  if (value === "available_now") return "Available now";
  if (value === "contact") return "Contact for availability";
  return "Available on a date";
}

function petLabel(rental: PublicRentalDetailData["rental"]) {
  if (!rental.pets?.status) return rental.petPolicy ?? "";
  const details = [
    humanize(rental.pets.status),
    rental.pets.catsAllowed ? "cats" : null,
    rental.pets.dogsAllowed ? "dogs" : null,
    rental.pets.maxCount ? `maximum ${rental.pets.maxCount}` : null,
    rental.pets.sizeLimitLbs ? `up to ${rental.pets.sizeLimitLbs} lbs` : null
  ].filter(Boolean);
  return `${details.join(" · ")}${rental.pets.notes ? ` — ${rental.pets.notes}` : ""}`;
}
