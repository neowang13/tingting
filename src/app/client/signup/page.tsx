import type { Metadata } from "next";
import Link from "next/link";
import { ClientSignupForm } from "@/components/client/client-signup-form";
import { isDemoMode } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Create Client Account | Ting Ting Xu",
  robots: { index: false, follow: false }
};

export default function ClientSignupPage() {
  return (
    <main className="client-auth-page">
      <section className="client-auth-card">
        <p className="eyebrow">Private client portal</p>
        <h1>Create client account</h1>
        <p>Enter your name, email, and password. You must verify your email before the account can be used.</p>
        <ClientSignupForm authMode={isDemoMode() ? "local" : "supabase"} />
        <p className="client-auth-switch"><Link className="text-link" href="/client/login">Back to Client Login</Link></p>
        <div className="client-security-note">
          <strong>Client accounts are separate from Admin.</strong>
          <p>Registering never grants staff access. Your account can only see records assigned to your own client identity.</p>
        </div>
        <p className="client-legal-links"><Link href="/privacy">Privacy</Link><Link href="/terms/application">Application terms</Link></p>
      </section>
    </main>
  );
}
