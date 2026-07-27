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
  searchParams: Promise<{ error?: string }>;
}) {
  const error = (await searchParams).error;
  return (
    <main className="admin-body" style={{ display: "grid", placeItems: "center", padding: 20 }}>
      <section className="card" style={{ width: "min(440px, 100%)" }}>
        <div className="eyebrow">TING TING XU</div>
        <h1>Admin Sign In</h1>
        {error && loginMessages[error] && <p role="alert">{loginMessages[error]}</p>}
        <LoginForm authMode={isDemoMode() ? "local" : "supabase"} />
      </section>
    </main>
  );
}
