import type { Metadata } from "next";
import { GuestApplicationEntry } from "@/components/guest/guest-application-entry";
import { getOptionalClientIdentity } from "@/lib/client-auth";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Joint application | Silverkey", robots: { index: false, follow: false } };
export default async function InvitationsPage() {
  return <GuestApplicationEntry signedIn={Boolean(await getOptionalClientIdentity())} />;
}
