import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ServiceLandingPage } from "@/components/public/service-landing-page";
import { loadPublicHomepageData } from "@/features/content/public-homepage";
import { loadPublicServicePageData } from "@/features/content/public-service-page";
import {
  getAllServicePages,
  getServicePageDefinitionBySlug
} from "@/features/content/service-pages";

export const dynamic = "force-dynamic";

export function generateStaticParams() {
  return getAllServicePages().map((page) => ({ slug: page.slug }));
}

export async function generateMetadata({
  params
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const definition = getServicePageDefinitionBySlug((await params).slug);
  if (!definition) return {};

  const serviceData = await loadPublicServicePageData(definition.slug);
  const description = serviceData?.page.description ?? definition.content.description;

  const title = `${definition.displayName} | Ting Ting Xu`;
  return {
    title,
    description,
    alternates: { canonical: `/services/${definition.slug}` },
    openGraph: {
      title,
      description,
      url: `/services/${definition.slug}`,
      type: "website"
    }
  };
}

export default async function ServicePage({
  params
}: {
  params: Promise<{ slug: string }>;
}) {
  const slug = (await params).slug;
  const [serviceData, homepageData] = await Promise.all([
    loadPublicServicePageData(slug),
    loadPublicHomepageData()
  ]);
  if (!serviceData) notFound();

  return (
    <ServiceLandingPage
      page={serviceData.page}
      sectionKey={serviceData.sectionKey}
      sections={homepageData.sections}
      mediaUrls={serviceData.mediaUrls}
    />
  );
}
