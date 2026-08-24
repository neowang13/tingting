import { isDemoMode } from "@/lib/auth";
import { LoginForm } from "@/components/admin/login-form";

const loginMessages: Record<string, string> = {
  session_expired: "Your session expired. Sign in again to continue.",
  mfa_required: "Complete multi-factor verification to open Admin.",
  inactive: "This administrator account is inactive. Contact the account owner.",
  configuration: "Administrator sign-in is not configured."
};

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; reset?: string }>;
}) {
  const { error, reset } = await searchParams;
  return (
    <main className="admin-body admin-auth-page">
      <section className="admin-auth-card">
        <div className="admin-auth-brand">Ting Ting Admin</div>
        <h1>Sign in</h1>
        <p className="admin-auth-intro">
          Review rental applications and manage Silverkey tenants.
        </p>
        {reset === "success" && <p className="form-status success" role="status">Password updated. Sign in with the new password.</p>}
        {error && loginMessages[error] && <p className="form-status error" role="alert">{loginMessages[error]}</p>}
        <LoginForm authMode={isDemoMode() ? "local" : "supabase"} />
        <p className="admin-auth-help">Private staff access. Do not share administrator credentials.</p>
      </section>
    </main>
  );
}
