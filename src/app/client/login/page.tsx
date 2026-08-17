import type { Metadata } from "next";
import Link from "next/link";
import { ClientLoginForm } from "@/components/client/client-login-form";
import { isDemoMode } from "@/lib/auth";
import { sanitizeClientNextPath } from "@/lib/client-signup";

export const metadata: Metadata = { title: "Client Login | Ting Ting Xu", robots: { index: false, follow: false } };

export default async function ClientLoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[]; property?: string; reset?: string; verification?: string; recovery?: string }> }) {
  const query = await searchParams;
  const nextPath = sanitizeClientNextPath(query.next);
  const signupPath = nextPath === "/"
    ? "/client/signup"
    : `/client/signup?${new URLSearchParams({ next: nextPath })}`;
  return <main className="client-auth-page"><section className="client-auth-card"><p className="eyebrow">Private application portal</p><h1>Client Login</h1><p>{query.property ? "Sign in to start or continue the application for the rental you selected." : "Sign in to return to the website, browse rentals, manage applications, and book viewings."}</p>{query.reset === "success" && <p className="form-status success" role="status">Password updated. Sign in with your new password.</p>}{query.verification === "success" && <p className="form-status success" role="status">Email verified. Sign in to continue.</p>}{query.verification === "error" && <p className="form-status error" role="alert">That verification link is invalid or expired. Request another email from the registration page.</p>}{query.recovery === "error" && <p className="form-status error" role="alert">That password recovery link is invalid or expired. Request a new password recovery email below.</p>}<ClientLoginForm authMode={isDemoMode() ? "local" : "supabase"} nextPath={nextPath} /><p className="client-auth-switch">New client? <Link className="text-link" href={signupPath}>Create client account</Link></p>{query.property && <div className="application-access-note"><strong>Your selected rental is ready.</strong><p>After sign-in, review the listing and start or continue your own application.</p></div>}<div className="client-security-note"><strong>Keep personal information out of email.</strong><p>Application details and identity documents must be submitted only through this authenticated portal. Access expires after inactivity.</p></div><p className="client-legal-links"><Link href="/privacy">Privacy</Link><Link href="/terms/application">Application terms</Link></p></section></main>;
}
