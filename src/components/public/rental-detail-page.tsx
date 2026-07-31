import Link from "next/link";
import {
  Bath,
  BedDouble,
  Building2,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleParking,
  ClipboardCheck,
  House,
  MapPin,
  PawPrint,
  Ruler,
  ShieldCheck,
  Sofa,
  Warehouse
} from "lucide-react";
import { ContactModalProvider, ContactTrigger } from "@/components/public/contact-modal";
import { RentalCard } from "@/components/public/rental-card";
import { RentalGallery } from "@/components/public/rental-gallery";
import { SaveListingButton } from "@/components/public/save-listing-button";
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

type Rental = PublicRentalDetailData["rental"];

interface DetailItem {
  label: string;
  value?: string | null;
}

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
  const availability = rental.availableOn
    ? formatRentalAvailability(rental.availableOn)
    : rental.availabilityStatus
      ? availabilityLabel(rental.availabilityStatus)
      : null;
  const lease = leaseLabel(rental);
  const petPolicy = petLabel(rental);
  const propertyType = rental.property?.propertyType
    ? humanize(rental.property.propertyType)
    : null;
  const amenityCards = amenityGroups
    .map((group) => ({
      label: group.label,
      items: group.items.filter(([code]) => rental.amenityCodes?.includes(code))
    }))
    .filter((group) => group.items.length > 0);
  const utilityLabels = new Map(utilityOptions);
  const utilities = rental.includedUtilityCodes?.map(
    (code) => utilityLabels.get(code as never) ?? humanize(code)
  ) ?? [];
  const glanceItems: DetailItem[] = [
    { label: "Building name", value: rental.property?.buildingName },
    { label: "Unit number", value: rental.property?.unitNumber },
    { label: "Neighbourhood", value: rental.neighbourhood },
    { label: "City", value: rental.city },
    { label: "Province", value: provinceLabel(rental.property?.provinceCode) },
    { label: "Postal code", value: rental.property?.postalCode },
    { label: "Country", value: rental.property?.countryCode === "CA" ? "Canada" : null },
    { label: "Property type", value: propertyType },
    { label: "Bedrooms / Bathrooms", value: `${formatRentalCount(rental.bedrooms)} / ${formatRentalCount(rental.bathrooms)}` },
    { label: "Dens", value: rental.denCount ? String(rental.denCount) : null },
    { label: "Square feet", value: rental.squareFeet !== null ? formatRentalArea(rental.squareFeet) : null },
    { label: "Furnishing", value: rental.furnishedStatus ? humanize(rental.furnishedStatus) : null },
    { label: "Availability", value: availability },
    { label: "Lease type", value: lease }
  ].filter((item) => Boolean(item.value));
  const hasParkingStorage = Boolean(
    rental.parking?.available || rental.parking?.visitorAvailable || rental.parking?.notes ||
    rental.storage?.available || rental.storage?.notes
  );
  const hasPolicyRequirements = Boolean(
    petPolicy || rental.smokingPolicy || rental.creditCheckRequired || rental.referencesRequired
  );

  return (
    <ContactModalProvider contact={sections.contact}>
      <div className="rental-detail-page">
        <div className="rental-detail-hero">
          <SiteHeader header={sections.header} />
          <div className="container rental-detail-hero-inner">
            <nav className="rental-breadcrumb" aria-label="Breadcrumb">
              <Link href="/">Home</Link>
              <ChevronRight aria-hidden />
              <Link href="/rentals">Rentals</Link>
              <ChevronRight aria-hidden />
              <span aria-current="page">{rental.addressLine}, {rental.city}</span>
            </nav>
            <div className="rental-gallery-stage">
              {availability && <span className="rental-status-badge">{availability}</span>}
              <RentalGallery title={rental.title} city={rental.city} images={images} />
            </div>
          </div>
        </div>

        <main className="rental-detail-content">
          <div className="container rental-listing-shell">
            <section className="rental-listing-overview" aria-labelledby="rental-title">
              <header className="rental-listing-heading">
                <div>
                  <h1 id="rental-title">{rental.title}</h1>
                  <p className="rental-summary-address"><MapPin aria-hidden />{rental.addressLine}</p>
                  <p>{formatRentalLocation(rental.neighbourhood, rental.city)}</p>
                </div>
                <div className="rental-heading-price">
                  <strong className="rent-price">{formatRentalPrice(rental.monthlyRentCents)} <span>/ month</span></strong>
                  {propertyType && <span className="rental-property-type"><Building2 aria-hidden />{propertyType}</span>}
                </div>
              </header>

              <dl className="rental-quick-facts">
                <QuickFact icon={<BedDouble aria-hidden />} label="Bedrooms" value={formatRentalCount(rental.bedrooms)} />
                <QuickFact icon={<Bath aria-hidden />} label="Bathrooms" value={formatRentalCount(rental.bathrooms)} />
                {rental.denCount !== undefined && <QuickFact icon={<House aria-hidden />} label="Dens" value={String(rental.denCount)} />}
                {rental.squareFeet !== null && <QuickFact icon={<Ruler aria-hidden />} label="Sq. ft." value={rental.squareFeet.toLocaleString("en-CA")} />}
                {rental.furnishedStatus && <QuickFact icon={<Sofa aria-hidden />} label="Furnishing" value={humanize(rental.furnishedStatus)} />}
                {availability && <QuickFact icon={<CalendarDays aria-hidden />} label="Availability" value={availability} accent />}
              </dl>

              <div className="rental-primary-actions">
                {lease && <p><strong>Lease:</strong> {lease}</p>}
                <div>
                  <SaveListingButton slug={rental.slug} />
                  <ContactTrigger className="button secondary rental-contact-button">Ask Ting Ting</ContactTrigger>
                  <ContactTrigger className="button">Book a viewing</ContactTrigger>
                </div>
              </div>

              <section className="rental-about" aria-labelledby="rental-about-heading">
                <div>
                  <h2 id="rental-about-heading">About this home</h2>
                  {paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
                </div>
                <aside className="rental-about-summary" aria-label="Property overview">
                  {rental.property?.buildingName && <DetailLine label="Building" value={rental.property.buildingName} />}
                  {propertyType && <DetailLine label="Property type" value={propertyType} />}
                  <DetailLine label="Location" value={formatRentalLocation(rental.neighbourhood, rental.city)} />
                  {availability && <DetailLine label="Availability" value={availability} />}
                </aside>
              </section>

              <section className="rental-glance" aria-labelledby="rental-glance-heading">
                <h2 id="rental-glance-heading">At a glance</h2>
                <dl>
                  {glanceItems.map((item) => (
                    <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>
                  ))}
                </dl>
              </section>

              {(hasParkingStorage || hasPolicyRequirements || utilities.length > 0 || rental.utilitiesNotes || amenityCards.length > 0 || rental.amenityNotes) && (
                <section className="rental-information-grid" aria-label="Rental features and policies">
                  {(hasParkingStorage || hasPolicyRequirements || utilities.length > 0 || rental.utilitiesNotes) && (
                    <div className="rental-practical-grid">
                      {hasParkingStorage && (
                        <article className="rental-info-card">
                          <h2><CircleParking aria-hidden />Parking &amp; storage</h2>
                          <ul>
                            {rental.parking?.available && <InfoItem label="Parking available" value={parkingLabel(rental)} />}
                            {rental.parking?.visitorAvailable && <InfoItem label="Visitor parking" value="Available" />}
                            {rental.parking?.notes && <InfoItem label="Parking notes" value={rental.parking.notes} />}
                            {rental.storage?.available && <InfoItem label="Storage available" value={storageLabel(rental)} />}
                            {rental.storage?.notes && <InfoItem label="Storage notes" value={rental.storage.notes} />}
                          </ul>
                        </article>
                      )}

                      {hasPolicyRequirements && (
                        <article className="rental-info-card">
                          <h2><PawPrint aria-hidden />Pets, smoking &amp; requirements</h2>
                          <ul>
                            {petPolicy && <InfoItem label="Pet policy" value={petPolicy} />}
                            {rental.smokingPolicy && <InfoItem label="Smoking policy" value={humanize(rental.smokingPolicy)} />}
                            {rental.creditCheckRequired && <InfoItem label="Application" value="Credit check required" />}
                            {rental.referencesRequired && <InfoItem label="Application" value="References required" />}
                          </ul>
                        </article>
                      )}

                      {(utilities.length > 0 || rental.utilitiesNotes) && (
                        <article className="rental-info-card">
                          <h2><ShieldCheck aria-hidden />Included utilities</h2>
                          {utilities.length > 0 && <CheckList items={utilities} />}
                          {rental.utilitiesNotes && <p className="rental-info-note"><strong>Additional notes</strong>{rental.utilitiesNotes}</p>}
                        </article>
                      )}
                    </div>
                  )}

                  {amenityCards.length > 0 && (
                    <div className={`rental-amenity-grid rental-amenity-grid-${amenityCards.length}`}>
                      {amenityCards.map((group) => (
                        <article className="rental-info-card rental-amenity-card" key={group.label}>
                          <h2><CheckCircle2 aria-hidden />{group.label}</h2>
                          <CheckList items={group.items.map(([, label]) => label)} />
                        </article>
                      ))}
                    </div>
                  )}

                  {rental.amenityNotes && (
                    <article className="rental-info-card rental-feature-note">
                      <h2><ClipboardCheck aria-hidden />Additional features</h2>
                      <p className="rental-info-note">{rental.amenityNotes}</p>
                    </article>
                  )}
                </section>
              )}

              {(rental.fees?.length ?? 0) > 0 && (
                <section className="rental-fees" aria-labelledby="rental-fees-heading">
                  <h2 id="rental-fees-heading">Fees &amp; deposits</h2>
                  <ul>
                    {rental.fees?.map((fee, index) => (
                      <li key={fee.id ?? `${fee.feeType}-${index}`}>
                        <span className="rental-fee-icon"><Warehouse aria-hidden /></span>
                        <span><strong>{fee.label ?? humanize(fee.feeType)}</strong>{fee.notes && <small>{fee.notes}</small>}</span>
                        <span><strong>{formatRentalPrice(fee.amountCents)}</strong><small>{fee.frequency === "monthly" ? "Monthly" : "One time"}{fee.refundable ? " · Refundable" : ""}{fee.required ? " · Required" : ""}</small></span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </section>

          </div>

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
                    <RentalCard rental={candidate} imageLoading="eager" key={candidate.id} />
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

function QuickFact({
  icon,
  label,
  value,
  accent = false
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent?: boolean;
}) {
  return <div className={accent ? "accent" : undefined}><dt>{icon}<span>{value}</span></dt><dd>{label}</dd></div>;
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return <p><span>{label}</span><strong>{value}</strong></p>;
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return <li><Check aria-hidden /><span><strong>{label}</strong><small>{value}</small></span></li>;
}

function CheckList({ items }: { items: readonly string[] }) {
  return <ul className="rental-check-list">{items.map((item) => <li key={item}><Check aria-hidden />{item}</li>)}</ul>;
}

function humanize(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function availabilityLabel(value: NonNullable<Rental["availabilityStatus"]>) {
  if (value === "available_now") return "Available now";
  if (value === "contact") return "Contact for availability";
  return "Available on a date";
}

function leaseLabel(rental: Rental) {
  if (!rental.leaseType) return null;
  const type = humanize(rental.leaseType);
  return rental.minimumLeaseMonths ? `${type} · ${rental.minimumLeaseMonths} months minimum` : type;
}

function petLabel(rental: Rental) {
  if (!rental.pets?.status) return rental.petPolicy;
  const details = [
    humanize(rental.pets.status),
    rental.pets.catsAllowed ? "Cats" : null,
    rental.pets.dogsAllowed ? "Dogs" : null,
    rental.pets.maxCount ? `Maximum ${rental.pets.maxCount}` : null,
    rental.pets.sizeLimitLbs ? `Up to ${rental.pets.sizeLimitLbs} lbs` : null
  ].filter(Boolean);
  return `${details.join(" · ")}${rental.pets.notes ? ` — ${rental.pets.notes}` : ""}`;
}

function parkingLabel(rental: Rental) {
  const parking = rental.parking;
  if (!parking) return "Available";
  return [
    parking.type ? humanize(parking.type) : null,
    parking.stalls !== null ? `${parking.stalls} stall${parking.stalls === 1 ? "" : "s"}` : null,
    parking.included ? "Included in rent" : null
  ].filter(Boolean).join(" · ") || "Available";
}

function storageLabel(rental: Rental) {
  const storage = rental.storage;
  if (!storage) return "Available";
  return [
    storage.lockers !== null ? `${storage.lockers} locker${storage.lockers === 1 ? "" : "s"}` : null,
    storage.included ? "Included in rent" : null
  ].filter(Boolean).join(" · ") || "Available";
}

function provinceLabel(code?: string | null) {
  if (!code) return null;
  if (code === "BC") return "British Columbia";
  return code;
}
