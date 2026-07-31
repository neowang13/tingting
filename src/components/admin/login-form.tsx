"use client";

import { createBrowserClient } from "@supabase/ssr";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

export function LoginForm({ authMode }: { authMode: "local" | "supabase" }) {
  const router = useRouter();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabase = useMemo(
    () => (url && anonKey ? createBrowserClient(url, anonKey) : null),
    [anonKey, url]
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<"password" | "challenge" | "enroll">("password");
  const [factorId, setFactorId] = useState("");
  const [qrCode, setQrCode] = useState("");
  const [totpSecret, setTotpSecret] = useState("");
  const [accountEmail, setAccountEmail] = useState("");

  async function recordFailure(
    event: "login_failed" | "mfa_challenge_failed",
    reason: "invalid_credentials" | "invalid_or_expired_code" | "enrollment_failed" | "session_establishment_failed",
    email?: string
  ) {
    await fetch("/api/auth/security-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, reason, email })
    }).catch(() => undefined);
  }

  async function finishLogin(
    mfaFlow?: "challenge" | "enrollment",
    session?: { access_token: string; refresh_token: string } | null
  ) {
    if (authMode === "supabase") {
      const response = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mfaFlow,
          accessToken: session?.access_token,
          refreshToken: session?.refresh_token
        })
      });
      if (!response.ok) {
        await recordFailure("mfa_challenge_failed", "session_establishment_failed", accountEmail);
        await supabase?.auth.signOut();
        setError("The administrator session could not be established.");
        setBusy(false);
        return;
      }
    }
    router.replace("/admin");
    router.refresh();
  }

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError("");
        const form = new FormData(event.currentTarget);
        if (authMode === "local") {
          const response = await fetch("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: String(form.get("email")),
              password: String(form.get("password"))
            })
          });
          if (!response.ok) {
            setError(
              response.status === 429
                ? "Too many sign-in attempts. Please wait and try again."
                : "Email or password is incorrect."
            );
            setBusy(false);
            return;
          }
          await finishLogin();
          return;
        }

        if (!supabase) {
          setError("Supabase authentication is not configured.");
          setBusy(false);
          return;
        }

        if (stage !== "password") {
          const verified = await supabase.auth.mfa.challengeAndVerify({
            factorId,
            code: String(form.get("code")).trim()
          });
          if (verified.error) {
            await recordFailure("mfa_challenge_failed", "invalid_or_expired_code", accountEmail);
            setError("That verification code is incorrect or expired.");
            setBusy(false);
            return;
          }
          await finishLogin(
            stage === "enroll" ? "enrollment" : "challenge",
            verified.data
          );
          return;
        }

        const email = String(form.get("email"));
        setAccountEmail(email);
        const signedIn = await supabase.auth.signInWithPassword({
          email,
          password: String(form.get("password"))
        });
        if (signedIn.error) {
          await recordFailure("login_failed", "invalid_credentials", email);
          setError("Email or password is incorrect.");
          setBusy(false);
          return;
        }

        if (process.env.NEXT_PUBLIC_APP_MODE !== "production") {
          await finishLogin(undefined, signedIn.data.session);
          return;
        }

        const factors = await supabase.auth.mfa.listFactors();
        const verifiedTotp = factors.data?.totp.find((factor) => factor.status === "verified");
        if (verifiedTotp) {
          setFactorId(verifiedTotp.id);
          setStage("challenge");
          setBusy(false);
          return;
        }

        const enrollment = await supabase.auth.mfa.enroll({
          factorType: "totp",
          friendlyName: "Ting Ting Admin"
        });
        if (enrollment.error || !enrollment.data.totp) {
          await recordFailure("mfa_challenge_failed", "enrollment_failed", email);
          await supabase.auth.signOut();
          setError("Multi-factor authentication could not be started. Please contact the account owner.");
          setBusy(false);
          return;
        }
        setFactorId(enrollment.data.id);
        setQrCode(enrollment.data.totp.qr_code);
        setTotpSecret(enrollment.data.totp.secret);
        setStage("enroll");
        setBusy(false);
      }}
    >
      {stage === "password" ? (
        <>
          <div className="field">
            <label htmlFor="admin-email">Email</label>
            <input id="admin-email" name="email" type="email" autoComplete="username" required />
          </div>
          <div className="field">
            <label htmlFor="admin-password">Password</label>
            <input
              id="admin-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>
        </>
      ) : (
        <>
          <h2>{stage === "enroll" ? "Set up verification" : "Verification code"}</h2>
          {stage === "enroll" && (
            <>
              <p>Scan this code with an authenticator app, then enter the six-digit code.</p>
              {/* Supabase returns an SVG data URI, which next/image intentionally rejects. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                className="mfa-qr"
                src={qrCode}
                alt="Authenticator setup QR code"
                width={240}
                height={240}
              />
              <details>
                <summary>Enter the setup key manually</summary>
                <code className="mfa-secret">{totpSecret}</code>
              </details>
            </>
          )}
          <div className="field">
            <label htmlFor="admin-code">Six-digit code</label>
            <input
              id="admin-code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              minLength={6}
              maxLength={6}
              required
              autoFocus
            />
          </div>
        </>
      )}
      <button className="button" disabled={busy} type="submit">
        {busy ? "Checking…" : stage === "password" ? "Sign In" : "Verify and continue"}
      </button>
      {error && <p className="form-status error" role="alert" aria-live="assertive">{error}</p>}
    </form>
  );
}
