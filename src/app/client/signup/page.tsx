import type { Metadata } from "next";
import Link from "next/link";
import { ClientAuthShell } from "@/components/client/client-auth-shell";
import { ClientSignupForm } from "@/components/client/client-signup-form";
import { isDemoMode } from "@/lib/auth";
import { sanitizeClientNextPath } from "@/lib/client-signup";

export const metadata: Metadata = {
  title: "Create Client Account | Ting Ting Xu",
  robots: { index: false, follow: false }
};

export default async function ClientSignupPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const query = await searchParams;
  const nextPath = sanitizeClientNextPath(query.next);
  const loginPath = nextPath === "/"
    ? "/client/login"
    : `/client/login?${new URLSearchParams({ next: nextPath })}`;
  return (
    <ClientAuthShell heading="Create one secure account. Return whenever you need.">
      <section className="client-auth-card">
        <p className="eyebrow">Create your client account</p>
        <h1>Start your application</h1>
        <p>Create an account to save your progress, upload documents securely, and return to your application at any time.</p>
        <ClientSignupForm authMode={isDemoMode() ? "local" : "supabase"} nextPath={nextPath} />
        <p className="client-verification-note">After creating your account, verify your email before signing in. The verification link expires for your security.</p>
        <p className="client-auth-switch"><Link className="text-link" href={loginPath}>Back to Client Login</Link></p>
        <div className="client-security-note">
          <strong>Client accounts are separate from Admin.</strong>
          <p>Registering never grants staff access. Your account can only see records assigned to your own client identity.</p>
        </div>
        <p className="client-legal-links"><Link href="/privacy">Privacy</Link><Link href="/terms/application">Application terms</Link></p>
      </section>
    </ClientAuthShell>
  );
}
