import type { Metadata } from "next";
import Link from "next/link";
import { ClientLogoutButton } from "@/components/client/client-logout-button";
import { requireClientPage } from "@/lib/client-auth";
import { listClientApplications } from "@/features/applications/service";
import { PUBLIC_CONTACT_EMAIL } from "@/lib/site-contact";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "My Applications | Ting Ting Xu", robots: { index: false, follow: false } };

export default async function ClientApplicationsPage({ searchParams }: { searchParams: Promise<{ property?: string }> }) {
  const identity = await requireClientPage();
  const property = (await searchParams).property;
  const applications = (await listClientApplications(identity)).sort((a, b) => Number(b.propertySlug === property) - Number(a.propertySlug === property));
  return <main className="client-main"><div className="client-account-bar"><div><span>Signed in as</span><strong>{identity.displayName}</strong></div><ClientLogoutButton /></div><section className="client-list-heading"><p className="eyebrow">Secure client area</p><h1>My applications</h1><p>Complete the online application, save your progress, upload requested documents securely, and keep your submission receipt.</p></section>{property && !applications.some((application) => application.propertySlug === property) && <section className="client-panel application-access-note"><h2>This property is not assigned to your account yet</h2><p>Request a viewing or contact Ting Ting to have the correct application assigned. Do not send personal documents by email.</p><Link className="button secondary" href={`/rentals/${encodeURIComponent(property)}`}>Return to the rental</Link></section>}<div className="client-application-list">{applications.map((application) => <article className={`client-application-card${application.propertySlug === property ? " requested-property" : ""}`} key={application.id}><div>{application.propertySlug === property && <span className="application-match-label">Selected property</span>}<h2>{application.propertyTitle}</h2><p>{application.propertyAddress}</p><small>Reference {application.id}</small></div><div><span className={`application-status status-${application.status}`}>{application.status.replaceAll("_", " ")}</span><Link className="button" href={`/client/applications/${application.id}`}>{application.status === "draft" ? "Continue application" : "View status and receipt"}</Link></div></article>)}</div>{applications.length === 0 && <section className="client-panel empty-state"><h2>No assigned applications</h2><p>When staff assigns an application to this account, it will appear here. Contact <a href={`mailto:${PUBLIC_CONTACT_EMAIL}`}>{PUBLIC_CONTACT_EMAIL}</a> if you expected one.</p></section>}</main>;
}
