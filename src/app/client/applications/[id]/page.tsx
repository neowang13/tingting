import type { Metadata } from "next";
import { ApplicationPortal } from "@/components/client/application-portal";
import { ClientPortalHeader } from "@/components/client/client-portal-header";
import { requireClientPage } from "@/lib/client-auth";
import { getApplicationTerms, getClientApplication } from "@/features/applications/service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Rental Application | Ting Ting Xu", robots: { index: false, follow: false } };

export default async function ClientApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  const identity = await requireClientPage({ nextPath: `/client/applications/${encodeURIComponent(id)}` });
  const [application, termsText] = await Promise.all([getClientApplication(identity, id), getApplicationTerms(identity, id)]);
  return <><ClientPortalHeader displayName={identity.displayName} backHref="/client/applications" backLabel="All applications" /><main className="client-main"><ApplicationPortal application={application} termsText={termsText} /></main></>;
}
