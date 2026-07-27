"use client";

import { MapPin, Search } from "lucide-react";
import { useRouter } from "next/navigation";

interface Props {
  content: {
    locationLabel: string;
    locationPlaceholder: string;
    propertyTypeLabel: string;
    anyPropertyTypeLabel: string;
    priceRangeLabel: string;
    anyPriceLabel: string;
    bedsLabel: string;
    anyBedsLabel: string;
    bathsLabel: string;
    anyBathsLabel: string;
    submitLabel: string;
  };
}

export function buildRentalSearchUrl(entries: Iterable<[string, FormDataEntryValue]>) {
  const params = new URLSearchParams();
  for (const [key, value] of entries) {
    if (typeof value === "string" && value.trim()) params.set(key, value.trim());
  }
  return params.size ? `/rentals?${params.toString()}` : "/rentals";
}

export function RentalSearch({ content }: Props) {
  const router = useRouter();

  return (
    <form
      className="search-panel"
      aria-label={content.submitLabel}
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        router.push(buildRentalSearchUrl(form.entries()));
      }}
    >
      <div className="search-field search-location">
        <label htmlFor="rental-location">{content.locationLabel}</label>
        <div className="input-with-icon">
          <MapPin size={18} aria-hidden />
          <input
            id="rental-location"
            name="location"
            placeholder={content.locationPlaceholder}
            autoComplete="street-address"
          />
        </div>
      </div>
      <div className="search-field">
        <label htmlFor="property-type">{content.propertyTypeLabel}</label>
        <select id="property-type" name="propertyType" defaultValue="">
          <option value="">{content.anyPropertyTypeLabel}</option>
          <option value="apartment">Apartment</option>
          <option value="condo">Condo</option>
          <option value="townhome">Townhome</option>
          <option value="house">House</option>
          <option value="basement_suite">Basement suite</option>
          <option value="room">Room</option>
          <option value="other">Other</option>
        </select>
      </div>
      <div className="search-field">
        <label htmlFor="price-range">{content.priceRangeLabel}</label>
        <select id="price-range" name="priceRange" defaultValue="">
          <option value="">{content.anyPriceLabel}</option>
          <option value="under-2500">Under $2,500</option>
          <option value="2500-3000">$2,500–$3,000</option>
          <option value="over-3000">$3,000+</option>
        </select>
      </div>
      <div className="search-field">
        <label htmlFor="beds">{content.bedsLabel}</label>
        <select id="beds" name="beds" defaultValue="">
          <option value="">{content.anyBedsLabel}</option>
          <option value="1">1+</option>
          <option value="2">2+</option>
          <option value="3">3+</option>
        </select>
      </div>
      <div className="search-field">
        <label htmlFor="baths">{content.bathsLabel}</label>
        <select id="baths" name="baths" defaultValue="">
          <option value="">{content.anyBathsLabel}</option>
          <option value="1">1+</option>
          <option value="2">2+</option>
          <option value="3">3+</option>
        </select>
      </div>
      <button className="button search-submit" type="submit">
        <Search size={17} aria-hidden />
        {content.submitLabel}
      </button>
    </form>
  );
}
