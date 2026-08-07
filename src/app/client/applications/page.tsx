import type { Metadata } from "next";
import Link from "next/link";
import { ClientLogoutButton } from "@/components/client/client-logout-button";
import { requireClientPage } from "@/lib/client-auth";
import { listClientApplications } from "@/features/applications/service";
import { PUBLIC_CONTACT_EMAIL } from "@/lib/site-contact";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "My Applications | Ting Ting Xu", robots: { index: false, follow: false } };

export default async function ClientApplicationsPage({ searchParams }: { searchParams: Promise<{ property?: string }> }) {
  const property = (await searchParams).property;
  const nextPath = property ? `/client/applications?property=${encodeURIComponent(property)}` : "/client/applications";
  const identity = await requireClientPage({ nextPath, propertySlug: property });
  const applications = (await listClientApplications(identity)).sort((a, b) => Number(b.propertySlug === property) - Number(a.propertySlug === property));
  return <main className="client-main"><div className="client-account-bar"><Link href="/">← Back to website</Link><div><span>Signed in as</span><strong>{identity.displayName}</strong></div><ClientLogoutButton /></div><section className="client-list-heading"><p className="eyebrow">Secure client area</p><h1>My applications</h1><p>Complete the online application, save your progress, upload requested documents securely, and keep your submission receipt.</p></section>{property && !applications.some((application) => application.propertySlug === property) && <section className="client-panel application-access-note"><h2>No application has been started for this property</h2><p>Return to the rental and choose Apply online to start your private application.</p><Link className="button secondary" href={`/rentals/${encodeURIComponent(property)}`}>Return to the rental</Link></section>}<div className="client-application-list">{applications.map((application) => <article className={`client-application-card${application.propertySlug === property ? " requested-property" : ""}`} key={application.id}><div>{application.propertySlug === property && <span className="application-match-label">Selected property</span>}<h2>{application.propertyTitle}</h2><p>{application.propertyAddress}</p><small>Reference {application.id}</small></div><div><span className={`application-status status-${application.status}`}>{application.status.replaceAll("_", " ")}</span><Link className="button" href={`/client/applications/${application.id}`}>{application.status === "draft" ? "Continue application" : "View status and receipt"}</Link></div></article>)}</div>{applications.length === 0 && <section className="client-panel empty-state"><h2>No applications yet</h2><p>Browse the available rentals, open a listing, and choose Apply online when you find a home you want. For help, contact <a href={`mailto:${PUBLIC_CONTACT_EMAIL}`}>{PUBLIC_CONTACT_EMAIL}</a>.</p><Link className="button" href="/rentals">Browse rentals</Link></section>}</main>;
}
