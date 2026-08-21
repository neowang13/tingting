import type { Metadata } from "next";
import Link from "next/link";
import { APPLICATION_TERMS_VERSION, applicationTermsText } from "@/features/applications/contracts";
import { SiteFooter } from "@/components/public/site-chrome";
import { loadPublicHomepageData } from "@/features/content/public-homepage";

export const metadata: Metadata = { title: "Application Terms | Ting Ting Xu", robots: { index: false, follow: false } };

export default async function ApplicationTermsPage() {
  const { sections } = await loadPublicHomepageData();
  return <><main className="legal-page"><article><p className="eyebrow">Version {APPLICATION_TERMS_VERSION}</p><h1>Rental application terms and consent</h1>{applicationTermsText.split("\n").map((paragraph, index) => paragraph ? <p key={index}>{paragraph}</p> : null)}<p><Link href="/privacy">Read the privacy notice</Link> · <Link href="/client/login">Client Login</Link></p></article></main><SiteFooter footer={sections.footer} /></>;
}
