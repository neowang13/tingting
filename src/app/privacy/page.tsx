import type { Metadata } from "next";
import Link from "next/link";
import { PUBLIC_CONTACT_EMAIL } from "@/lib/site-contact";
import { SiteFooter } from "@/components/public/site-chrome";
import { loadPublicHomepageData } from "@/features/content/public-homepage";

export const metadata: Metadata = { title: "Privacy Notice | Ting Ting Xu" };

export default async function PrivacyPage() {
  const { sections } = await loadPublicHomepageData();
  return <><main className="legal-page"><article><p className="eyebrow">Privacy and applicant information</p><h1>How application information is handled</h1><h2>Purpose and collection</h2><p>The application portal collects the completed application and supporting files needed to assess a specific rental application, verify supplied information, contact references, perform authorized screening, and communicate about the result. It does not obtain marketing consent.</p><h2>Access and disclosure</h2><p>Access is limited to the authenticated applicant and authorized staff with a processing need. Information may be disclosed to the landlord of the unit and approved screening or secure-processing providers only for the stated application purposes. Private files are not published and are not sent in URL parameters or general notification emails.</p><h2>Security</h2><p>Sessions are server-validated and time-limited. Files are restricted by size and content type, stored under random keys in a private bucket, and marked for malware-risk screening before staff processing. Security cannot eliminate every risk; report a suspected incident promptly.</p><h2>Retention and deletion</h2><p>Submitted records are scheduled for review after 12 months, unless a decision affecting the applicant, dispute, legal obligation, or approved retention hold requires a different period. Eligible records are securely deleted or de-identified. Withdrawal does not automatically override a lawful retention requirement.</p><h2>Access, correction, withdrawal, and questions</h2><p>Email <a href={`mailto:${PUBLIC_CONTACT_EMAIL}`}>{PUBLIC_CONTACT_EMAIL}</a> with the application reference only. Do not email identity documents or completed application content.</p><p><Link href="/terms/application">Application terms</Link> · <Link href="/client/login">Client Login</Link></p></article></main><SiteFooter footer={sections.footer} /></>;
}
