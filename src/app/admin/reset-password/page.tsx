import { ResetPasswordForm } from "@/components/admin/reset-password-form";

export default function ResetPasswordPage() {
  return (
    <main className="admin-body admin-auth-page">
      <section className="admin-auth-card">
        <div className="admin-auth-brand">Ting Ting Admin</div>
        <h1>Reset password</h1>
        <p className="admin-auth-intro">
          Choose a new password with at least 14 characters that you have not reused elsewhere.
        </p>
        <ResetPasswordForm />
      </section>
    </main>
  );
}
