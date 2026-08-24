import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ClientPortalHeader } from "@/components/client/client-portal-header";
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
    <><ClientPortalHeader displayName={identity.displayName} backHref={`/rentals/${encodeURIComponent(rental.slug)}`} backLabel="Back to listing" />
    <main className="client-main">
      <div className="client-apply-layout">
        <section className="client-panel client-apply-confirmation">
          <p className="eyebrow">Private online application</p>
          <h1>Apply for {rental.title}</h1>
          <p className="client-apply-address"><strong>{rental.addressLine}, {rental.city}</strong></p>
          <p>Confirm this is the home you want, then start a private application or continue the draft already connected to your account.</p>
          <div className="client-apply-facts">
            <div><span>Monthly rent</span><strong>${(rental.monthlyRentCents / 100).toLocaleString("en-CA")}</strong></div>
            <div><span>Bedrooms</span><strong>{rental.bedrooms}</strong></div>
            <div><span>Bathrooms</span><strong>{rental.bathrooms}</strong></div>
          </div>
          <div className="client-apply-actions"><ClientStartApplicationButton propertySlug={rental.slug} /><Link className="text-link" href="/client/applications">View all my applications</Link></div>
          <div className="client-security-note"><span aria-hidden>◇</span><p>Your progress saves to your account. Application documents are private and are not attached to email.</p></div>
        </section>
        <aside className="client-property-preview" aria-label="Selected property">
          <div className="client-property-preview-image">{rental.coverImageUrl ? <Image src={rental.coverImageUrl} alt="" width={660} height={440} unoptimized /> : <span>Silverkey property</span>}</div>
          <div><span className="eyebrow">Selected property</span><strong>{rental.title}</strong><small>{rental.addressLine}</small></div>
          <Link href={`/rentals/${encodeURIComponent(rental.slug)}`}>Review listing details ↗</Link>
        </aside>
      </div>
    </main></>
  );
}
