import type { Metadata } from "next";
import Link from "next/link";
import { APPLICATION_TERMS_VERSION, applicationTermsText } from "@/features/applications/contracts";

export const metadata: Metadata = { title: "Application Terms | Ting Ting Xu", robots: { index: false, follow: false } };

export default function ApplicationTermsPage() {
  return <main className="legal-page"><article><p className="eyebrow">Version {APPLICATION_TERMS_VERSION}</p><h1>Rental application terms and consent</h1><p className="legal-review-warning">Draft for final legal/privacy review. Do not use for real applicants until the controller identity, recipients, screening provider, credit-check type, retention rules, and applicant rights are approved.</p>{applicationTermsText.split("\n").map((paragraph, index) => paragraph ? <p key={index}>{paragraph}</p> : null)}<p><Link href="/privacy">Read the privacy notice</Link> · <Link href="/client/login">Client Login</Link></p></article></main>;
}
