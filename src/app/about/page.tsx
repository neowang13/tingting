import type { Metadata } from "next";
import { AboutPageExperience } from "@/components/public/about-page";
import { SiteFooter, SiteHeader } from "@/components/public/site-chrome";
import { loadPublicHomepageData } from "@/features/content/public-homepage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "About Ting Ting Xu | Silverkey Real Estate",
  description:
    "Meet Ting Ting Xu and Silverkey's current four-person team, then explore TingTing's historical recognition and Greater Vancouver sales archive.",
  alternates: { canonical: "/about" }
};

export default async function AboutPage() {
  const { sections } = await loadPublicHomepageData();

  return (
    <>
      <SiteHeader header={sections.header} />
      <AboutPageExperience />
      <SiteFooter footer={sections.footer} />
    </>
  );
}
