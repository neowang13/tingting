import type { Metadata } from "next";
import Link from "next/link";
import { ClientAuthShell } from "@/components/client/client-auth-shell";
import { ClientResetPasswordForm } from "@/components/client/client-reset-password-form";

export const metadata: Metadata = { title: "Reset Client Password | Ting Ting Xu", robots: { index: false, follow: false } };

export default function ClientResetPasswordPage() {
  return <ClientAuthShell heading="Reset access without losing your application progress.">
    <section className="client-auth-card">
      <p className="eyebrow">Secure client area</p>
      <h1>Set a new password</h1>
      <p>Choose a new password with at least 11 characters that you have not reused elsewhere.</p>
      <ClientResetPasswordForm />
      <p className="client-auth-switch"><Link className="text-link" href="/client/login">Back to Client Login</Link></p>
    </section>
  </ClientAuthShell>;
}
