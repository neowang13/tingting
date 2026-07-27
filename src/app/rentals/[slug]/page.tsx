import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { RentalDetailPage } from "@/components/public/rental-detail-page";
import { loadPublicRentalDetailData } from "@/features/content/public-rental-detail";

interface Props {
  params: Promise<{ slug: string }>;
}

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const data = await loadPublicRentalDetailData(slug);
  if (!data) return {};
  const description = data.rental.description
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
  return {
    title: `${data.rental.title} | Ting Ting Xu Rentals`,
    description,
    alternates: { canonical: `/rentals/${data.rental.slug}` },
    openGraph: {
      title: data.rental.title,
      description,
      url: `/rentals/${data.rental.slug}`,
      images: data.rental.coverImageUrl
        ? [{ url: data.rental.coverImageUrl, alt: data.rental.title }]
        : undefined
    }
  };
}

export default async function RentalDetailRoute({ params }: Props) {
  const { slug } = await params;
  const data = await loadPublicRentalDetailData(slug);
  if (!data) notFound();
  return <RentalDetailPage {...data} />;
}
