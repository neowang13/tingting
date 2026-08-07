import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ClientLogoutButton } from "@/components/client/client-logout-button";
import { ClientStartApplicationButton } from "@/components/client/client-start-application-button";
import { getRepository } from "@/data/repository";
import { requireClientPage } from "@/lib/client-auth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Start Rental Application | Ting Ting Xu", robots: { index: false, follow: false } };

export default async function ClientApplyPage({ params }: { params: Promise<{ slug: string }> }) {
  const slug = (await params).slug;
  const nextPath = `/client/apply/${encodeURIComponent(slug)}`;
  const identity = await requireClientPage({ nextPath, propertySlug: slug });
  const rental = await getRepository().getPublicRentalBySlug(slug);
  if (!rental) notFound();

  return (
    <main className="client-main">
      <div className="client-account-bar">
        <Link href={`/rentals/${encodeURIComponent(rental.slug)}`}>← Back to listing</Link>
        <div><span>Signed in as</span><strong>{identity.displayName}</strong></div>
        <ClientLogoutButton />
      </div>
      <section className="client-panel client-apply-confirmation">
        <p className="eyebrow">Private online application</p>
        <h1>Apply for {rental.title}</h1>
        <p><strong>{rental.addressLine}, {rental.city}</strong></p>
        <p>Start a private application for this rental, or continue the application already connected to your account. No other Client can view it.</p>
        <ClientStartApplicationButton propertySlug={rental.slug} />
        <p><Link className="text-link" href="/client/applications">View all my applications</Link></p>
      </section>
    </main>
  );
}
