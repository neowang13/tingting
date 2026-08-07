import type { Metadata } from "next";
import Link from "next/link";
import { ClientLoginForm } from "@/components/client/client-login-form";
import { isDemoMode } from "@/lib/auth";

export const metadata: Metadata = { title: "Client Login | Ting Ting Xu", robots: { index: false, follow: false } };

export default async function ClientLoginPage({ searchParams }: { searchParams: Promise<{ next?: string; property?: string; reset?: string }> }) {
  const query = await searchParams;
  const nextPath = query.next?.startsWith("/client/") && !query.next.startsWith("//") && query.next.length <= 500
    ? query.next
    : "/client/applications";
  return <main className="client-auth-page"><section className="client-auth-card"><p className="eyebrow">Private application portal</p><h1>Client Login</h1><p>{query.property ? "Sign in to continue the application connected to the rental you selected." : "Sign in to complete assigned rental applications, save your progress, upload documents securely, and check submission status."}</p>{query.reset === "success" && <p className="form-status success" role="status">Password updated. Sign in with your new password.</p>}<ClientLoginForm authMode={isDemoMode() ? "local" : "supabase"} nextPath={nextPath} />{query.property && <div className="application-access-note"><strong>Application access is by invitation.</strong><p>If this property has not been assigned to your account, request a viewing or contact Ting Ting. Public self-registration is intentionally disabled.</p></div>}<div className="client-security-note"><strong>Keep personal information out of email.</strong><p>Application details and identity documents must be submitted only through this authenticated portal. Access expires after inactivity.</p></div><p className="client-legal-links"><Link href="/privacy">Privacy</Link><Link href="/terms/application">Application terms</Link></p></section></main>;
}
