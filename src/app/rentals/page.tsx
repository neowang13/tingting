import Link from "next/link";
import { RentalCard } from "@/components/public/rental-card";
import { getRepository } from "@/data/repository";
import { rentalSearchQuerySchema } from "@/lib/schemas";
import type { Metadata } from "next";
import { sanitizePublicRentalImages } from "@/lib/public-image-url";
import { SiteFooter } from "@/components/public/site-chrome";
import { loadPublicHomepageData } from "@/features/content/public-homepage";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Greater Vancouver Rentals | Ting Ting Xu",
  description: "Browse current published rental homes across Greater Vancouver.",
  alternates: { canonical: "/rentals" }
};

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function RentalsPage({ searchParams }: Props) {
  const { sections } = await loadPublicHomepageData();
  const raw = await searchParams;
  const parsed = rentalSearchQuerySchema.safeParse(
    Object.fromEntries(
      Object.entries(raw)
        .filter(([, value]) => typeof value === "string" && value)
        .map(([key, value]) => [key, value])
    )
  );
  const query = parsed.success ? parsed.data : {};
  const rentals = (await getRepository().listRentals(false))
    .map(sanitizePublicRentalImages)
    .filter((rental) => {
      const location = query.location?.toLocaleLowerCase();
      if (
        location &&
        ![rental.addressLine, rental.neighbourhood, rental.city]
          .filter(Boolean)
          .some((value) => value?.toLocaleLowerCase().includes(location))
      ) return false;
      if (query.beds !== undefined && rental.bedrooms < query.beds) return false;
      if (query.baths !== undefined && rental.bathrooms < query.baths) return false;
      if (query.priceRange === "under-2500" && rental.monthlyRentCents >= 250_000) return false;
      if (
        query.priceRange === "2500-3000" &&
        (rental.monthlyRentCents < 250_000 || rental.monthlyRentCents > 300_000)
      ) return false;
      if (query.priceRange === "over-3000" && rental.monthlyRentCents < 300_000) return false;
      if (
        query.propertyType &&
        rental.property?.propertyType !== query.propertyType
      ) return false;
      return true;
    });

  return (
    <>
      <main className="section">
        <div className="container">
        <Link className="text-link" href="/">← Back to home</Link>
        <h1 style={{ fontSize: "3.5rem" }}>Greater Vancouver Rentals</h1>
        <form className="rental-list-filters" role="search">
          <label>Location<input name="location" defaultValue={query.location} /></label>
          <label>Price
            <select name="priceRange" defaultValue={query.priceRange ?? ""}>
              <option value="">Any price</option>
              <option value="under-2500">Under $2,500</option>
              <option value="2500-3000">$2,500–$3,000</option>
              <option value="over-3000">$3,000+</option>
            </select>
          </label>
          <label>Property type
            <select name="propertyType" defaultValue={query.propertyType ?? ""}>
              <option value="">Any type</option>
              <option value="apartment">Apartment</option>
              <option value="condo">Condo</option>
              <option value="townhome">Townhome</option>
              <option value="house">House</option>
              <option value="basement_suite">Basement suite</option>
              <option value="room">Room</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label>Beds<input name="beds" type="number" min="0" defaultValue={query.beds} /></label>
          <label>Baths<input name="baths" type="number" min="0" defaultValue={query.baths} /></label>
          <button className="button" type="submit">Apply filters</button>
        </form>
        {rentals.length ? (
          <div className="rental-grid">
            {rentals.map((rental) => <RentalCard rental={rental} key={rental.id} />)}
          </div>
        ) : (
          <div className="empty-state">
            <h2>No rentals match these filters</h2>
            <p>Adjust your search or tell Ting Ting what kind of home you need.</p>
            <Link className="button" href="/#contact">Contact Ting Ting</Link>
          </div>
        )}
        </div>
      </main>
      <SiteFooter footer={sections.footer} />
    </>
  );
}
