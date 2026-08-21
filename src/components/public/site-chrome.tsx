import Link from "next/link";
import Image from "next/image";
import { Mail, Phone } from "lucide-react";
import type { PublicHomepageData } from "@/features/content/public-homepage";
import { MobileNavigation } from "@/components/public/mobile-navigation";
import { DesktopNavigation } from "@/components/public/desktop-navigation";
import { ClientAccountMenu } from "@/components/public/client-account-menu";
import { getOptionalClientIdentity } from "@/lib/client-auth";

type HeaderContent = PublicHomepageData["sections"]["header"];
type FooterContent = PublicHomepageData["sections"]["footer"];

export async function SiteHeader({
  header,
  variant = "default"
}: {
  header: HeaderContent;
  variant?: "default" | "home";
}) {
  const client = await getOptionalClientIdentity();
  const navigation = [
    { key: "home", label: "Home", href: "/" },
    ...header.navigation.map((item) =>
      item.key === "about" ? { ...item, href: "/about" } : item
    )
  ];
  return (
    <header className={`site-header${variant === "home" ? " site-header-home" : ""}`}>
      <div className="container header-inner">
        <div className="home-header-brand-group">
          <Link className="brand" href="/" aria-label="Silverkey home">
            <Image
              className="brand-logo"
              src="/images/silverkey-logo-nav.png"
              alt="Silverkey"
              width={442}
              height={128}
              priority
              unoptimized
            />
          </Link>
          {variant === "home" && (
            <>
              <span className="home-header-divider" aria-hidden />
              <Image
                className="home-header-remax"
                src="/images/remax-city-realty-logo-white-v2.png"
                alt="RE/MAX City Realty"
                width={1164}
                height={1000}
                priority
                unoptimized
              />
              <span className="home-header-brokerage">Brokerage</span>
            </>
          )}
        </div>
        <nav className="desktop-nav" aria-label="Primary navigation">
          {variant === "home"
            ? <DesktopNavigation items={navigation} />
            : navigation.map((item) => <Link key={item.key} href={item.href}>{item.label}</Link>)}
          {client ? (
            <ClientAccountMenu displayName={client.displayName} />
          ) : (
            <Link className="button header-cta" href={header.contactCta.href}>
              {header.contactCta.label}
            </Link>
          )}
        </nav>
        {variant === "home" ? (
          <div className="home-mobile-header-actions">
            <Link className="home-mobile-login" href={client ? "/client/applications" : header.contactCta.href}>
              {client ? "Portal" : header.contactCta.label}
            </Link>
            <MobileNavigation items={navigation} contactCta={header.contactCta} client={client} />
          </div>
        ) : (
          <MobileNavigation items={navigation} contactCta={header.contactCta} client={client} />
        )}
      </div>
    </header>
  );
}

export function SiteFooter({ footer }: { footer: FooterContent }) {
  return (
    <footer className="home-footer">
      <div className="home-wide-shell home-footer-grid">
        <div className="home-footer-identity">
          <Image src="/images/silverkey-logo-nav.png" alt="Silverkey" width={442} height={128} unoptimized />
          <p><strong>TingTing Xu Personal Real Estate Corporation</strong><br />{footer.summary}</p>
          <div className="home-footer-brokerage">
            <Image src="/images/remax-city-realty-logo-white-v2.png" alt="RE/MAX City Realty" width={1164} height={1000} unoptimized />
            <span>RE/MAX City Realty<br />Brokerage</span>
          </div>
          <a href={`tel:${footer.phone.replace(/[^\d+]/g, "")}`}><Phone aria-hidden />{footer.phone}</a>
          <a href={`mailto:${footer.email}`}><Mail aria-hidden />{footer.email}</a>
        </div>
        <nav aria-label="Footer navigation">
          <div><strong>Explore</strong><Link href="/">Home</Link><Link href="/#rentals">Rent</Link><Link href="/#services">Service</Link><Link href="/about">About</Link><Link href="/#contact">Contact</Link></div>
          <div><strong>Clients</strong><Link href="/client/login">Client login</Link><Link href="/client/applications">My applications</Link><Link href="/rentals">Saved homes</Link></div>
          <div><strong>Legal</strong><Link href="/privacy">Privacy</Link><Link href="/terms/application">Application terms</Link><span>Service area: Greater Vancouver</span></div>
        </nav>
      </div>
      <div className="home-wide-shell home-footer-legal">
        {footer.disclosureParagraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
        <p>© {new Date().getFullYear()} Silverkey. All rights reserved.</p>
      </div>
    </footer>
  );
}
