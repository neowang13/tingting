import Image from "next/image";
import Link from "next/link";
import { Bath, BedDouble, House, Ruler } from "lucide-react";
import {
  formatRentalArea,
  formatRentalCount,
  formatRentalLocation,
  formatRentalPrice
} from "@/features/content/public-rental-detail";
import type { RentalListing } from "@/lib/contracts";

export function RentalCard({ rental }: { rental: RentalListing }) {
  return (
    <article className="rental-card">
      <div className="rental-media">
        {rental.coverImageUrl ? (
          <Image
            src={rental.coverImageUrl}
            alt={`${rental.title} in ${rental.city}`}
            fill
            sizes="(max-width: 700px) 100vw, (max-width: 1050px) 50vw, 25vw"
          />
        ) : (
          <div className="rental-image-placeholder" role="img" aria-label={rental.title}>
            <House aria-hidden />
          </div>
        )}
      </div>
      <div className="rental-card-body">
        <strong className="rent-price">{formatRentalPrice(rental.monthlyRentCents)} <span>/ month</span></strong>
        <h3>{rental.title}</h3>
        <p className="rental-address">
          {rental.addressLine}<br />
          {formatRentalLocation(rental.neighbourhood, rental.city)}
        </p>
        <dl className="rental-card-facts">
          <div><dt><BedDouble aria-hidden /> Bedrooms</dt><dd>{formatRentalCount(rental.bedrooms)}</dd></div>
          <div><dt><Bath aria-hidden /> Bathrooms</dt><dd>{formatRentalCount(rental.bathrooms)}</dd></div>
          {rental.squareFeet !== null && (
            <div><dt><Ruler aria-hidden /> Size</dt><dd>{formatRentalArea(rental.squareFeet)}</dd></div>
          )}
        </dl>
        <Link className="text-link" href={`/rentals/${rental.slug}`}>View rental →</Link>
      </div>
    </article>
  );
}
