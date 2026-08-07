import type { Metadata } from "next";
import { ClientResetPasswordForm } from "@/components/client/client-reset-password-form";

export const metadata: Metadata = { title: "Reset Client Password | Ting Ting Xu", robots: { index: false, follow: false } };

export default function ClientResetPasswordPage() {
  return <main className="client-auth-page"><section className="client-auth-card"><p className="eyebrow">Secure client area</p><h1>Reset password</h1><p>Choose a new password with at least 11 characters that you have not reused elsewhere.</p><ClientResetPasswordForm /></section></main>;
}
