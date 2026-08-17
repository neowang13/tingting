import Link from "next/link";
import Image from "next/image";
import { Facebook, Instagram, Linkedin, Mail, MapPin, Phone } from "lucide-react";
import type { PublicHomepageData } from "@/features/content/public-homepage";
import { MobileNavigation } from "@/components/public/mobile-navigation";
import { ClientAccountMenu } from "@/components/public/client-account-menu";
import { getOptionalClientIdentity } from "@/lib/client-auth";

type HeaderContent = PublicHomepageData["sections"]["header"];
type FooterContent = PublicHomepageData["sections"]["footer"];

export async function SiteHeader({ header }: { header: HeaderContent }) {
  const client = await getOptionalClientIdentity();
  const navigation = header.navigation.map((item) =>
    item.key === "about" ? { ...item, href: "/about" } : item
  );
  return (
    <header className="site-header">
      <div className="container header-inner">
        <Link className="brand" href="/" aria-label="Silverkey home">
          <Image
            className="brand-logo"
            src="/images/silverkey-logo-nav.png"
            alt="Silverkey"
            width={442}
            height={128}
            priority
          />
        </Link>
        <nav className="desktop-nav" aria-label="Primary navigation">
          {navigation.map((item) => (
            <Link key={item.key} href={item.href}>{item.label}</Link>
          ))}
          {client ? (
            <ClientAccountMenu displayName={client.displayName} />
          ) : (
            <Link className="button header-cta" href={header.contactCta.href}>
              {header.contactCta.label}
            </Link>
          )}
        </nav>
        <MobileNavigation items={navigation} contactCta={header.contactCta} client={client} />
      </div>
    </header>
  );
}

export function SiteFooter({ footer }: { footer: FooterContent }) {
  const social = [
    { key: "facebook", href: footer.socialLinks.facebook, label: "Facebook", Icon: Facebook },
    { key: "instagram", href: footer.socialLinks.instagram, label: "Instagram", Icon: Instagram },
    { key: "linkedin", href: footer.socialLinks.linkedin, label: "LinkedIn", Icon: Linkedin }
  ].filter((item) => item.href);

  return (
    <footer className="site-footer">
      <div className="container footer-main">
        <div className="footer-identity-column">
          <Image
            className="footer-silverkey-logo"
            src="/images/silverkey-logo-nav.png"
            alt="Silverkey"
            width={442}
            height={128}
          />
          <p className="footer-corporation-name">
            <strong>TingTing Xu</strong>
            <span>Personal Real Estate Corporation</span>
          </p>
          <p>{footer.summary}</p>
          <div className="social-links">
            {social.map(({ key, href, label, Icon }) => (
              <a key={key} href={href} target="_blank" rel="noopener noreferrer" aria-label={label}>
                <Icon size={20} aria-hidden />
              </a>
            ))}
          </div>
        </div>
        <div className="footer-details">
          <div className="footer-detail-group">
            <strong>Contact</strong>
            <a href={`tel:${footer.phone.replace(/[^\d+]/g, "")}`}><Phone size={17} aria-hidden />{footer.phone}</a>
            <a href={`mailto:${footer.email}`}><Mail size={17} aria-hidden />{footer.email}</a>
          </div>
          <div className="footer-detail-group">
            <strong>Office</strong>
            {footer.officeLines.map((line) => <span key={line}><MapPin size={17} aria-hidden />{line}</span>)}
          </div>
        </div>
        <div className="footer-remax-column">
          <span className="footer-brokerage-label">Brokerage</span>
          <Image
            className="footer-remax-logo"
            src="/images/remax-city-realty-logo-white-v2.png"
            alt="RE/MAX City Realty"
            width={1164}
            height={1000}
          />
        </div>
      </div>
      <div className="container footer-bottom">
        <div className="footer-disclosures">
          {footer.disclosureParagraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
        </div>
        <p className="footer-legal-links"><Link href="/privacy">Privacy</Link><Link href="/terms/application">Application terms</Link><Link href="/client/applications">My applications</Link></p>
      </div>
    </footer>
  );
}
