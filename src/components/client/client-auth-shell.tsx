import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

export function ClientAuthShell({ children, heading = "Your application stays between you and Silverkey." }: { children: ReactNode; heading?: string }) {
  return <main className="client-auth-page client-login-page">
    <section className="client-auth-shell">
      <aside className="client-auth-brand-panel">
        <Link href="/" aria-label="Silverkey home">
          <Image src="/images/silverkey-logo-nav.png" alt="Silverkey" width={221} height={64} priority />
        </Link>
        <div className="client-auth-brand-copy">
          <p className="eyebrow">Private client area</p>
          <h2>{heading}</h2>
          <ul>
            <li>Continue a saved application without losing your progress.</li>
            <li>Upload requested documents to private storage.</li>
            <li>Check your status and keep your submission receipt.</li>
          </ul>
        </div>
        <div className="client-auth-brokerage">
          <Image src="/images/remax-city-realty-logo-white.png" alt="RE/MAX City Realty" width={54} height={46} />
          <span>Brokerage<br />Ting Ting Xu PREC</span>
        </div>
      </aside>
      <div className="client-auth-workspace">
        <header className="client-auth-topbar">
          <Link href="/">← Back to website</Link>
          <span>▣ Encrypted connection</span>
        </header>
        <div className="client-auth-form-wrap">{children}</div>
      </div>
    </section>
  </main>;
}
