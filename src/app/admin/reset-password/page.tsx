import { ResetPasswordForm } from "@/components/admin/reset-password-form";

export default function ResetPasswordPage() {
  return (
    <main className="admin-body" style={{ display: "grid", placeItems: "center", padding: 20 }}>
      <section className="card" style={{ width: "min(440px, 100%)" }}>
        <div className="eyebrow">TING TING XU</div>
        <h1>Reset Admin Password</h1>
        <p>Choose a new password that has not been shared in chat or reused elsewhere.</p>
        <ResetPasswordForm />
      </section>
    </main>
  );
}
