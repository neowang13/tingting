import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getRepository } from "@/data/repository";
import type { Metadata } from "next";

interface Props {
  params: Promise<{ slug: string }>;
}

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const rental = (await getRepository().listRentals(false)).find((item) => item.slug === slug);
  if (!rental) return {};
  return {
    title: `${rental.title} | Ting Ting Xu Rentals`,
    description: rental.description.slice(0, 160),
    alternates: { canonical: `/rentals/${rental.slug}` },
    openGraph: {
      title: rental.title,
      description: rental.description.slice(0, 160),
      url: `/rentals/${rental.slug}`,
      images: rental.coverImageUrl ? [{ url: rental.coverImageUrl, alt: rental.title }] : undefined
    }
  };
}

export default async function RentalDetailPage({ params }: Props) {
  const { slug } = await params;
  const rental = (await getRepository().listRentals(false)).find((item) => item.slug === slug);
  if (!rental) notFound();

  return (
    <main className="section">
      <article className="container rental-detail">
        <Link className="text-link" href="/rentals">← All rentals</Link>
        <div className="rental-detail-grid">
          <div className="rental-detail-media">
            {rental.coverImageUrl ? (
              <Image
                src={rental.coverImageUrl}
                alt={`${rental.title} in ${rental.city}`}
                width={1400}
                height={900}
                priority
                sizes="(max-width: 800px) 100vw, 60vw"
              />
            ) : <div className="rental-image-placeholder" role="img" aria-label={rental.title} />}
          </div>
          <div>
            <p className="eyebrow">{[rental.neighbourhood, rental.city].filter(Boolean).join(", ")}</p>
            <h1>{rental.title}</h1>
            <p className="rent-price">${(rental.monthlyRentCents / 100).toLocaleString("en-CA")} / month</p>
            <p>{rental.addressLine}</p>
            <dl className="rental-detail-facts">
              <div><dt>Bedrooms</dt><dd>{rental.bedrooms}</dd></div>
              <div><dt>Bathrooms</dt><dd>{rental.bathrooms}</dd></div>
              {rental.squareFeet && <div><dt>Size</dt><dd>{rental.squareFeet.toLocaleString()} sq. ft.</dd></div>}
              {rental.availableOn && <div><dt>Available</dt><dd>{rental.availableOn}</dd></div>}
              {rental.petPolicy && <div><dt>Pet policy</dt><dd>{rental.petPolicy}</dd></div>}
            </dl>
            <p>{rental.description}</p>
            <Link className="button" href="/#contact">Book a viewing</Link>
          </div>
        </div>
      </article>
    </main>
  );
}
