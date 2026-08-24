import Image from "next/image";
import Link from "next/link";
import { ClientLogoutButton } from "@/components/client/client-logout-button";

export function ClientPortalHeader({ displayName, backHref, backLabel }: {
  displayName: string;
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <header className="client-portal-header">
      <div className="client-portal-nav">
        <Link className="client-portal-logo" href="/" aria-label="Silverkey home">
          <Image src="/images/silverkey-logo-nav.png" alt="Silverkey" width={221} height={64} priority />
        </Link>
        <nav aria-label="Client portal">
          {backHref && <Link href={backHref}>← {backLabel ?? "Back"}</Link>}
          <Link href="/client/applications">My applications</Link>
        </nav>
        <div className="client-portal-account">
          <span>{displayName}</span>
          <ClientLogoutButton />
        </div>
      </div>
    </header>
  );
}
