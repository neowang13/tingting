import type { Metadata } from "next";
import Link from "next/link";
import { ClientAuthShell } from "@/components/client/client-auth-shell";
import { ClientLoginForm } from "@/components/client/client-login-form";
import { getRepository } from "@/data/repository";
import { isDemoMode } from "@/lib/auth";
import { sanitizeClientNextPath } from "@/lib/client-signup";

export const metadata: Metadata = { title: "Client Login | Ting Ting Xu", robots: { index: false, follow: false } };

export default async function ClientLoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[]; property?: string; reset?: string; verification?: string; recovery?: string }> }) {
  const query = await searchParams;
  const nextPath = sanitizeClientNextPath(query.next);
  const signupPath = nextPath === "/"
    ? "/client/signup"
    : `/client/signup?${new URLSearchParams({ next: nextPath })}`;
  const rental = query.property
    ? await getRepository().getPublicRentalBySlug(query.property).catch(() => null)
    : null;

  return (
    <ClientAuthShell>
      <section className="client-auth-card">
              {rental && (
                <div className="client-property-context">
                  <div aria-hidden />
                  <div>
                    <span>Signing in to apply for</span>
                    <strong>{rental.title}</strong>
                    <small>{rental.addressLine} · ${(rental.monthlyRentCents / 100).toLocaleString("en-CA")} / month</small>
                  </div>
                </div>
              )}
              <p className="eyebrow">Secure client area</p>
              <h1>Client Login</h1>
              <p>Sign in to continue your rental application, upload requested documents, or check your application status.</p>
              {query.reset === "success" && <p className="form-status success" role="status">Your password has been updated. Sign in with your new password.</p>}
              {query.verification === "success" && <p className="form-status success" role="status">Email verified. Sign in to continue.</p>}
              {query.verification === "error" && <p className="form-status error" role="alert">That verification link is invalid or expired. Request another email from the registration page.</p>}
              {query.recovery === "error" && <p className="form-status error" role="alert">That password recovery link is invalid or expired. Request a new password recovery email below.</p>}
              <ClientLoginForm authMode={isDemoMode() ? "local" : "supabase"} nextPath={nextPath} />
              <p className="client-auth-switch">New to Silverkey? <Link className="text-link" href={signupPath}>Create an account</Link></p>
              <div className="client-security-note"><span aria-hidden>◇</span><p>Your application and documents are private. Silverkey will never ask you to email your password or banking credentials.</p></div>
              <p className="client-legal-links"><Link href="/privacy">Privacy</Link><Link href="/terms/application">Application terms</Link><Link href="/">Back to website</Link></p>
      </section>
    </ClientAuthShell>
  );
}
