import type { Metadata } from "next";
import { AboutPageExperience } from "@/components/public/about-page";
import { SiteFooter, SiteHeader } from "@/components/public/site-chrome";
import { loadPublicHomepageData } from "@/features/content/public-homepage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "About Ting Ting Xu | Silverkey Real Estate",
  description:
    "Meet TingTing Xu and Silverkey's four-person team, serving Greater Vancouver with rental, property management, and real estate support.",
  alternates: { canonical: "/about" }
};

export default async function AboutPage() {
  const { sections } = await loadPublicHomepageData();

  return (
    <>
      <SiteHeader header={sections.header} variant="home" />
      <AboutPageExperience />
      <SiteFooter footer={sections.footer} />
    </>
  );
}
