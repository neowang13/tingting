import { SiteHome } from "@/components/public/site-home";
import { loadPublicHomepageData } from "@/features/content/public-homepage";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  alternates: { canonical: "/" }
};

export default async function HomePage() {
  return <SiteHome {...(await loadPublicHomepageData())} />;
}
