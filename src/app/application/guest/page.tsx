import type { Metadata } from "next";
import { GuestApplicationEntry } from "@/components/guest/guest-application-entry";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Secure Co-applicant Application | Ting Ting Xu",
  robots: { index: false, follow: false }
};

export default function GuestApplicationPage() {
  return <GuestApplicationEntry />;
}
