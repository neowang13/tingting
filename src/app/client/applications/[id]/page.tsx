import type { Metadata } from "next";
import Link from "next/link";
import { ApplicationPortal } from "@/components/client/application-portal";
import { ClientLogoutButton } from "@/components/client/client-logout-button";
import { requireClientPage } from "@/lib/client-auth";
import { getApplicationTerms, getClientApplication } from "@/features/applications/service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Rental Application | Ting Ting Xu", robots: { index: false, follow: false } };

export default async function ClientApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const identity = await requireClientPage();
  const id = (await params).id;
  const [application, termsText] = await Promise.all([getClientApplication(identity, id), getApplicationTerms(identity, id)]);
  return <main className="client-main"><div className="client-account-bar"><Link href="/client/applications">← My applications</Link><ClientLogoutButton /></div><ApplicationPortal application={application} termsText={termsText} /></main>;
}
