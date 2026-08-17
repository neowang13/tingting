import type { Metadata } from "next";
import Link from "next/link";
import { ContactRequesterActions } from "@/components/public/contact-requester-actions";
import { readShowingContactToken } from "@/features/showings/contact-link";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Contact showing requester | Silverkey",
  robots: { index: false, follow: false }
};

export default async function ContactRequesterPage({
  params
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const claims = readShowingContactToken(token);

  if (!claims) {
    return (
      <main className="contact-requester-page">
        <section className="contact-requester-card">
          <span className="contact-requester-kicker">SILVERKEY · SHOWING REQUEST</span>
          <h1>This contact link is unavailable.</h1>
          <p>The secure link may have expired. Return to the original email and copy the requester&apos;s phone number.</p>
          <Link href="/">Return to Silverkey</Link>
        </section>
      </main>
    );
  }

  return (
    <main className="contact-requester-page">
      <section className="contact-requester-card">
        <span className="contact-requester-kicker">SILVERKEY · SHOWING REQUEST</span>
        <h1>Contact {claims.requesterName}</h1>
        <dl>
          <div><dt>Property</dt><dd>{claims.propertyTitle}</dd></div>
          <div><dt>Requested time</dt><dd>{claims.requestedTime}</dd></div>
          <div><dt>Phone</dt><dd>{claims.phone}</dd></div>
        </dl>
        <ContactRequesterActions
          phone={claims.phone}
          requesterName={claims.requesterName}
          propertyTitle={claims.propertyTitle}
          requestedTime={claims.requestedTime}
        />
        <p className="contact-requester-note">If your device blocks Messages, copy the phone number or suggested message instead.</p>
      </section>
    </main>
  );
}
