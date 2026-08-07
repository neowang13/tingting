import Link from "next/link";
import { Facebook, Instagram, Linkedin, Mail, MapPin, Phone } from "lucide-react";
import type { PublicHomepageData } from "@/features/content/public-homepage";
import { MobileNavigation } from "@/components/public/mobile-navigation";

type HeaderContent = PublicHomepageData["sections"]["header"];
type FooterContent = PublicHomepageData["sections"]["footer"];

export function SiteHeader({ header }: { header: HeaderContent }) {
  return (
    <header className="site-header">
      <div className="container header-inner">
        <Link className="brand" href="/" aria-label={`${header.brandName} home`}>
          <strong>{header.brandName}</strong>
          <span>{header.brandSubtitle}</span>
        </Link>
        <nav className="desktop-nav" aria-label="Primary navigation">
          {header.navigation.map((item) => (
            <Link key={item.key} href={item.href}>{item.label}</Link>
          ))}
          <Link href="/client/login">Client Login</Link>
          <Link className="button header-cta" href={header.contactCta.href}>
            {header.contactCta.label}
          </Link>
        </nav>
        <MobileNavigation items={header.navigation} contactCta={header.contactCta} />
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
      <div className="container footer-grid">
        <div>
          <div className="footer-brand">{footer.brandName}<span>{footer.brandSubtitle}</span></div>
          <p>{footer.summary}</p>
          <div className="social-links">
            {social.map(({ key, href, label, Icon }) => (
              <a key={key} href={href} target="_blank" rel="noopener noreferrer" aria-label={label}>
                <Icon size={20} aria-hidden />
              </a>
            ))}
          </div>
        </div>
        <div>
          <strong>Contact</strong>
          <a href={`tel:${footer.phone.replace(/[^\d+]/g, "")}`}><Phone size={16} aria-hidden />{footer.phone}</a>
          <a href={`mailto:${footer.email}`}><Mail size={16} aria-hidden />{footer.email}</a>
        </div>
        <div>
          <strong>Office</strong>
          {footer.officeLines.map((line) => <span key={line}><MapPin size={16} aria-hidden />{line}</span>)}
        </div>
      </div>
      <div className="container disclosures">
        {footer.disclosureParagraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
        <p className="footer-legal-links"><Link href="/privacy">Privacy</Link><Link href="/terms/application">Application terms</Link><Link href="/client/login">Client Login</Link></p>
      </div>
    </footer>
  );
}
